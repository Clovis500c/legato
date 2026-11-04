//! Android's picker addresses (`content://`) over JNI: `PickedFile.kt` copies a document in, or a file out.
use anyhow::{anyhow, Result};
use jni::objects::{JClass, JObject, JString, JValue};
use jni::JavaVM;
use std::path::{Path, PathBuf};

const CLASS: &str = "app.legato.mobile.PickedFile";

/// `PickedFile.method(context, a, b)`: its string, None when it refused (unreadable, gone, no room).
fn call(method: &str, a: &str, b: &str) -> Result<Option<String>> {
    let ctx = ndk_context::android_context();
    // SAFETY: the pointers come from the Android runtime and live as long as the process.
    let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }?;
    let mut env = vm.attach_current_thread()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    // A native thread sees the system's classes only: the app's own come from its loader (as in keystore.rs).
    let loader = env.call_method(&activity, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
    let name = env.new_string(CLASS)?;
    let class = env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(&name)])?.l()?;
    let (a, b) = (env.new_string(a)?, env.new_string(b)?);
    let sig = "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;";
    let out = env.call_static_method(JClass::from(class), method, sig, &[JValue::Object(&activity), JValue::Object(&a), JValue::Object(&b)]);
    if env.exception_check()? {
        env.exception_clear()?;
        return Err(anyhow!("PickedFile.{method} failed"));
    }
    let out = out?.l()?;
    if out.is_null() {
        return Ok(None);
    }
    Ok(Some(env.get_string(&JString::from(out))?.into()))
}

/// The picked document, copied into dir: the copy's path.
pub fn copy_in(address: &str, dir: &Path) -> Result<PathBuf> {
    call("copyIn", address, &dir.to_string_lossy())?.map(PathBuf::from).ok_or_else(|| anyhow!("The file could not be read"))
}

/// The file at path written to the address the user picked: the document's name there.
pub fn copy_out(path: &Path, address: &str) -> Result<String> {
    call("copyOut", &path.to_string_lossy(), address)?.ok_or_else(|| anyhow!("The file could not be saved there"))
}
