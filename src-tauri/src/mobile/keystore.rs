//! Android's Keystore from Rust, over JNI: `KeystoreCrypto.kt` seals and opens bytes with a key that never leaves it.
use anyhow::{anyhow, Result};
use jni::objects::{JObject, JValue};
use jni::JavaVM;

const CLASS: &str = "app.legato.mobile.KeystoreCrypto";

fn call(method: &str, input: &[u8]) -> Result<Option<Vec<u8>>> {
    let ctx = ndk_context::android_context();
    // SAFETY: the pointers come from the Android runtime and live as long as the process.
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    // A native thread sees the system's classes only: the app's own come from its loader.
    let loader = env.call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
    let name = env.new_string(CLASS)?;
    let class = env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(&name)])?.l()?;
    let bytes = env.byte_array_from_slice(input)?;
    let out = env.call_static_method(jni::objects::JClass::from(class), method, "([B)[B", &[JValue::Object(&bytes)]);
    if env.exception_check()? {
        env.exception_clear()?;
        return Err(anyhow!("Keystore refused {method}"));
    }
    let out = out?.l()?;
    if out.is_null() {
        return Ok(None);
    }
    Ok(Some(env.convert_byte_array(jni::objects::JByteArray::from(out))?))
}

pub fn seal(plain: &[u8]) -> Result<Vec<u8>> {
    call("seal", plain)?.ok_or_else(|| anyhow!("Keystore returned nothing"))
}

/// None: damaged, or the key is gone.
pub fn open(sealed: &[u8]) -> Result<Option<Vec<u8>>> {
    call("open", sealed)
}
