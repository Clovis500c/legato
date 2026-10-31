//! Save a cover as a file: cut to what the big cover shows (video bars off), in the type the user picked.
use anyhow::{Context, Result, bail};
use image::{DynamicImage, ImageFormat, codecs::jpeg::JpegEncoder};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Part of an image, fractions of its size (front end's art box).
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, ts_rs::TS)]
#[ts(export, rename = "Box")]
pub struct Crop {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Crop {
    fn whole(&self) -> bool {
        self.w >= 0.999 && self.h >= 0.999
    }
}

/// File type from the picked name: png or jpg only.
pub fn wanted(path: &Path) -> Result<ImageFormat> {
    match path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("png") => Ok(ImageFormat::Png),
        Some("jpg" | "jpeg") => Ok(ImageFormat::Jpeg),
        _ => bail!("Save the cover as .jpg or .png"),
    }
}

/// Bytes to write. Same type, no crop = original bytes (no quality lost). Else decoded, cut, encoded (JPEG at 95).
pub fn encode(bytes: &[u8], crop: Option<Crop>, want: ImageFormat) -> Result<Vec<u8>> {
    let crop = crop.filter(|c| !c.whole());
    if crop.is_none() && image::guess_format(bytes).ok() == Some(want) {
        return Ok(bytes.to_vec());
    }
    let mut img = image::load_from_memory(bytes).context("Can't read this cover")?;
    if let Some(c) = crop {
        let (w, h) = (f64::from(img.width()), f64::from(img.height()));
        let x = (c.x.clamp(0.0, 1.0) * w).round();
        let y = (c.y.clamp(0.0, 1.0) * h).round();
        let cw = (c.w.clamp(0.0, 1.0) * w).round().min(w - x).max(1.0);
        let ch = (c.h.clamp(0.0, 1.0) * h).round().min(h - y).max(1.0);
        img = img.crop_imm(x as u32, y as u32, cw as u32, ch as u32);
    }
    let mut out = Vec::new();
    match want {
        ImageFormat::Jpeg => DynamicImage::ImageRgb8(img.to_rgb8()).write_with_encoder(JpegEncoder::new_with_quality(&mut out, 95))?,
        _ => img.write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png)?,
    }
    Ok(out)
}

/// Write the cover. Type this build can't decode (WebP, GIF): written as is, extension fixed. Returns the file written.
pub fn export(bytes: &[u8], crop: Option<Crop>, path: &Path) -> Result<PathBuf> {
    let want = wanted(path)?;
    let have = image::guess_format(bytes).ok();
    if !matches!(have, Some(ImageFormat::Png | ImageFormat::Jpeg)) {
        let ext = have.and_then(|f| f.extensions_str().first().copied()).context("Not an image")?;
        let out = path.with_extension(ext);
        std::fs::write(&out, bytes)?;
        return Ok(out);
    }
    std::fs::write(path, encode(bytes, crop, want)?)?;
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut out = Vec::new();
        DynamicImage::new_rgb8(w, h).write_to(&mut std::io::Cursor::new(&mut out), ImageFormat::Png).unwrap();
        out
    }

    #[test]
    fn same_type_no_crop_keeps_original_bytes() -> Result<()> {
        let src = png(40, 20);
        assert_eq!(encode(&src, None, ImageFormat::Png)?, src);
        assert_eq!(encode(&src, Some(Crop { x: 0.0, y: 0.0, w: 1.0, h: 1.0 }), ImageFormat::Png)?, src);
        Ok(())
    }

    #[test]
    fn cuts_bars_and_converts() -> Result<()> {
        let out = encode(&png(160, 90), Some(Crop { x: 0.25, y: 0.0, w: 0.5, h: 1.0 }), ImageFormat::Jpeg)?;
        assert_eq!(image::guess_format(&out)?, ImageFormat::Jpeg);
        let img = image::load_from_memory(&out)?;
        assert_eq!((img.width(), img.height()), (80, 90));
        Ok(())
    }

    #[test]
    fn crop_past_the_edge_stays_inside() -> Result<()> {
        let img = image::load_from_memory(&encode(&png(100, 100), Some(Crop { x: 0.9, y: -1.0, w: 0.5, h: 3.0 }), ImageFormat::Png)?)?;
        assert_eq!((img.width(), img.height()), (10, 100));
        Ok(())
    }

    #[test]
    fn picks_type_from_name_and_writes() -> Result<()> {
        assert!(wanted(Path::new("a.exe")).is_err());
        assert_eq!(wanted(Path::new("a.JPEG"))?, ImageFormat::Jpeg);
        let dir = tempfile::tempdir()?;
        let path = export(&png(10, 10), None, &dir.path().join("cover.png"))?;
        assert_eq!(std::fs::read(path)?, png(10, 10));
        // WebP can't be decoded here: kept as is, right extension.
        let webp = b"RIFF\x1a\0\0\0WEBPVP8 ".to_vec();
        let out = export(&webp, None, &dir.path().join("cover.jpg"))?;
        assert_eq!(out.extension().unwrap(), "webp");
        Ok(())
    }
}
