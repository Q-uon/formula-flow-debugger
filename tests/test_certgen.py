import ssl
import tempfile
import unittest
from pathlib import Path

from certgen import certificate_is_usable, certificate_thumbprint, generate_localhost_certificate


class CertificateGeneratorTests(unittest.TestCase):
    def test_generates_ssl_usable_localhost_certificate(self):
        with tempfile.TemporaryDirectory() as directory:
            cert = Path(directory) / "localhost.crt"
            key = Path(directory) / "localhost.key"
            generate_localhost_certificate(cert, key, days=30)
            self.assertTrue(certificate_is_usable(cert, key))
            decoded = ssl._ssl._test_decode_cert(str(cert))
            self.assertIn(("DNS", "localhost"), decoded["subjectAltName"])
            self.assertIn(("IP Address", "127.0.0.1"), decoded["subjectAltName"])
            self.assertEqual(len(certificate_thumbprint(cert)), 40)


if __name__ == "__main__":
    unittest.main()
