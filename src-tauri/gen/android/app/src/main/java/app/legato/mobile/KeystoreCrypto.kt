package app.legato.mobile

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// The phone's secrets file is sealed with an AES key that never leaves Android's Keystore (hardware backed when the phone
// has it). Called from Rust (`src-tauri/src/mobile/keystore.rs`) over JNI. Layout: 12 bytes of IV, then the ciphertext.
object KeystoreCrypto {
  private const val ALIAS = "legato-secrets"

  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    gen.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return gen.generateKey()
  }

  @JvmStatic
  fun seal(plain: ByteArray): ByteArray {
    val c = Cipher.getInstance("AES/GCM/NoPadding")
    c.init(Cipher.ENCRYPT_MODE, key())
    return c.iv + c.doFinal(plain)
  }

  // Null when the file is damaged or the key is gone (a restored backup, a reset lock screen).
  @JvmStatic
  fun open(sealed: ByteArray): ByteArray? =
    try {
      val c = Cipher.getInstance("AES/GCM/NoPadding")
      c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
      c.doFinal(sealed, 12, sealed.size - 12)
    } catch (e: Exception) {
      null
    }
}
