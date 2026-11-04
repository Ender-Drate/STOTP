import unittest

from stotp import crypto


class CryptoTest(unittest.TestCase):
    def test_hkdf_rfc5869_case1(self):
        ikm = bytes.fromhex("0b" * 22)
        salt = bytes.fromhex("000102030405060708090a0b0c")
        info = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9")
        okm = crypto.hkdf(ikm, salt, info, 42)
        self.assertEqual(
            okm.hex(),
            "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
            "34007208d5b887185865",
        )

    def test_totp_rfc6238_vector(self):
        secret = b"12345678901234567890"
        # RFC 6238 附录 B：T=59 时 8 位结果
        self.assertEqual(crypto.totp(secret, at=59, digits=8), "94287082")
        self.assertEqual(crypto.totp(secret, at=1111111109, digits=8), "07081804")

    def test_totp_verify_window(self):
        secret = b"12345678901234567890"
        now = 1_700_000_000
        code = crypto.totp(secret, at=now)
        self.assertTrue(crypto.totp_verify(secret, code, at=now))
        self.assertTrue(crypto.totp_verify(secret, code, at=now + 30))
        self.assertFalse(crypto.totp_verify(secret, code, at=now + 120))
        self.assertFalse(crypto.totp_verify(secret, "000000", at=now + 5))

    def test_uuid_deterministic_and_versioned(self):
        key = crypto.hkdf(b"seed", b"", b"uuid", 32)
        cid = "0f8fad5b-d9cb-469f-a165-70867728950e"
        first = crypto.derive_uuid(key, cid, 496000)
        second = crypto.derive_uuid(key, cid, 496000)
        other = crypto.derive_uuid(key, cid, 496001)
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertEqual(len(first), 36)
        self.assertEqual(first[14], "8")  # version 8

    def test_seal_roundtrip_and_tamper(self):
        key = b"k" * 32
        blob = crypto.seal(key, b"hello", b"aad")
        self.assertEqual(crypto.unseal(key, blob, b"aad"), b"hello")
        with self.assertRaises(Exception):
            crypto.unseal(key, blob[:-1] + bytes([blob[-1] ^ 1]), b"aad")

    def test_jwt_roundtrip(self):
        key = b"j" * 32
        token = crypto.jwt_encode({"sub": "acc_1", "exp": 9999999999}, key)
        self.assertEqual(crypto.jwt_decode(token, key)["sub"], "acc_1")
        with self.assertRaises(crypto.JWTError):
            crypto.jwt_decode(token + "x", key)

    def test_password_hash(self):
        encoded = crypto.hash_password("correct horse")
        self.assertTrue(crypto.verify_password("correct horse", encoded))
        self.assertFalse(crypto.verify_password("wrong", encoded))


if __name__ == "__main__":
    unittest.main()
