//! Nearby share: same network, 6-digit code, no server. mDNS finds senders, SPAKE2 turns the code into a key,
//! ChaCha20-Poly1305 seals the payload. Wrong code = receiver can't decrypt; sender gives up after a few tries.

use anyhow::{Context, Result, anyhow, bail, ensure};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use spake2::{Ed25519Group, Identity, Password, Spake2};
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;

pub const SERVICE: &str = "_musicapp._tcp.local.";
const ID: &[u8] = b"musicapp-nearby-v1";
/// Online guesses allowed per offer: 5 in 1,000,000.
const MAX_TRIES: usize = 5;
const OFFER_TTL: Duration = Duration::from_secs(600);
const STEP: Duration = Duration::from_secs(10);
const MAX_FRAME: u32 = 4 << 20;

pub fn new_code() -> String {
    format!("{:06}", rand::random_range(0..1_000_000u32))
}

async fn write_frame(s: &mut TcpStream, data: &[u8]) -> Result<()> {
    s.write_all(&(data.len() as u32).to_be_bytes()).await?;
    s.write_all(data).await?;
    Ok(())
}

async fn read_frame(s: &mut TcpStream) -> Result<Vec<u8>> {
    let len = s.read_u32().await?;
    ensure!(len <= MAX_FRAME, "Frame too big");
    let mut buf = vec![0; len as usize];
    s.read_exact(&mut buf).await?;
    Ok(buf)
}

/// Both sides: exchange SPAKE2 messages, derive the session key.
async fn handshake(s: &mut TcpStream, code: &str) -> Result<ChaCha20Poly1305> {
    let (spake, msg) = Spake2::<Ed25519Group>::start_symmetric(&Password::new(code.as_bytes()), &Identity::new(ID));
    write_frame(s, &msg).await?;
    let key = spake.finish(&read_frame(s).await?).map_err(|e| anyhow!("Handshake failed: {e:?}"))?;
    ChaCha20Poly1305::new_from_slice(&key).map_err(|_| anyhow!("Bad key"))
}

/// One exchange as sender. Ok = receiver decrypted and acked.
async fn send_over(s: &mut TcpStream, code: &str, payload: &[u8]) -> Result<()> {
    let cipher = handshake(s, code).await?;
    // Fresh key per session, one message: fixed nonce is safe.
    write_frame(s, &cipher.encrypt(&Nonce::default(), payload).map_err(|_| anyhow!("Encrypt failed"))?).await?;
    ensure!(s.read_u8().await? == 1, "No ack");
    Ok(())
}

async fn receive_over(s: &mut TcpStream, code: &str) -> Result<Vec<u8>> {
    let cipher = handshake(s, code).await?;
    let data = cipher.decrypt(&Nonce::default(), read_frame(s).await?.as_slice()).map_err(|_| anyhow!("Wrong code"))?;
    s.write_u8(1).await?;
    Ok(data)
}

/// Accept loop: done on first successful receiver, error after MAX_TRIES failures or TTL.
async fn serve_on(listener: TcpListener, code: &str, payload: &[u8], ttl: Duration) -> Result<()> {
    let deadline = tokio::time::Instant::now() + ttl;
    for _ in 0..MAX_TRIES {
        let (mut s, _) = tokio::time::timeout_at(deadline, listener.accept()).await.map_err(|_| anyhow!("Code expired: share again"))??;
        if let Ok(Ok(())) = timeout(STEP, send_over(&mut s, code, payload)).await {
            return Ok(());
        }
    }
    bail!("Too many wrong codes: share again")
}

/// mDNS announce; withdrawn on drop (offer done or task aborted).
struct Advert(ServiceDaemon);

impl Drop for Advert {
    fn drop(&mut self) {
        let _ = self.0.shutdown();
    }
}

/// Offer `payload` on the local network under `code` until one receiver takes it.
pub async fn serve(code: &str, payload: &[u8]) -> Result<()> {
    // All interfaces: receivers are other machines. Windows asks once to allow it on private networks.
    let listener = TcpListener::bind("0.0.0.0:0").await?;
    let port = listener.local_addr()?.port();
    let mdns = Advert(ServiceDaemon::new()?);
    let name = format!("music-app-{}", rand::random_range(0..u32::MAX));
    mdns.0.register(ServiceInfo::new(SERVICE, &name, &format!("{name}.local."), "", port, None)?.enable_addr_auto())?;
    serve_on(listener, code, payload, OFFER_TTL).await
}

async fn receive_from(peers: &[SocketAddr], code: &str) -> Result<Vec<u8>> {
    for addr in peers {
        if let Ok(Ok(mut s)) = timeout(STEP, TcpStream::connect(addr)).await
            && let Ok(Ok(data)) = timeout(STEP, receive_over(&mut s, code)).await
        {
            return Ok(data);
        }
    }
    bail!("Wrong code, or the sender stopped sharing")
}

/// Find senders on the network (3 s) and fetch the payload with `code`.
pub async fn receive(code: &str) -> Result<Vec<u8>> {
    ensure!(code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()), "The code has 6 digits");
    let mdns = Advert(ServiceDaemon::new()?);
    let events = mdns.0.browse(SERVICE)?;
    let peers = tokio::task::spawn_blocking(move || {
        let end = std::time::Instant::now() + Duration::from_secs(3);
        let mut peers = Vec::new();
        while let Some(left) = end.checked_duration_since(std::time::Instant::now()) {
            match events.recv_timeout(left) {
                Ok(ServiceEvent::ServiceResolved(info)) => peers.extend(info.get_addresses_v4().into_iter().map(|ip| SocketAddr::from((ip, info.get_port())))),
                Ok(_) => {}
                Err(_) => break,
            }
        }
        peers
    })
    .await
    .context("mDNS browse failed")?;
    drop(mdns);
    ensure!(!peers.is_empty(), "No Music App is sharing on this network");
    receive_from(&peers, code).await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn offer(code: &'static str, ttl: Duration) -> (SocketAddr, tokio::task::JoinHandle<Result<()>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        (addr, tokio::spawn(async move { serve_on(listener, code, b"playlist bytes", ttl).await }))
    }

    #[tokio::test]
    async fn right_code_gets_payload() {
        let (addr, server) = offer("123456", OFFER_TTL).await;
        assert_eq!(receive_from(&[addr], "123456").await.unwrap(), b"playlist bytes");
        server.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn wrong_codes_fail_then_offer_closes() {
        let (addr, server) = offer("123456", OFFER_TTL).await;
        for _ in 0..MAX_TRIES {
            assert!(receive_from(&[addr], "654321").await.is_err());
        }
        assert!(server.await.unwrap().unwrap_err().to_string().contains("Too many"));
    }

    #[tokio::test]
    async fn offer_expires() {
        let (_, server) = offer("123456", Duration::from_millis(50)).await;
        assert!(server.await.unwrap().unwrap_err().to_string().contains("expired"));
    }

    #[test]
    fn codes_are_six_digits() {
        assert!((0..50).map(|_| new_code()).all(|c| c.len() == 6 && c.bytes().all(|b| b.is_ascii_digit())));
    }
}
