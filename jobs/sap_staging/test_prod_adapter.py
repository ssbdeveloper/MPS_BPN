#!/usr/bin/env python3
"""Tests for production connection adapter in run_timesheet_etl.py.

Verifies:
1. Mode lab remains strictly loopback-only.
2. Mode prod reads configuration from environment variables.
3. Fail-closed on missing config, insecure TLS, or missing root certificates.
4. Passwords and credentials are never leaked in error messages or logs.
5. Central staging prod connection blocks safely if AWS RDS direct path is unconfigured.
6. Plant code and DB validation for both plants (5100 and 5051).
"""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run_timesheet_etl as etl


class LabModeAdapterTest(unittest.TestCase):
    """Test mode lab loopback protection and database resolution."""

    def test_lab_mode_resolves_lab_databases(self):
        self.assertEqual(etl.resolve_database("5100", env="lab"), "mps_timesheet_ckp_test")
        self.assertEqual(etl.resolve_database("5051", env="lab"), "mps_timesheet_bpn_test")

    def test_lab_mode_rejects_unknown_plant(self):
        with self.assertRaises(etl.EtlError) as ctx:
            etl.resolve_database("9999", env="lab")
        self.assertIn("tidak punya database lab terdaftar", str(ctx.exception))

    def test_lab_mode_rejects_non_loopback_host(self):
        with patch.dict(os.environ, {"MPS2_ETL_HOST": "192.168.1.100"}):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.connect_plant("mps_timesheet_ckp_test", env="lab")
            self.assertIn("bukan loopback", str(ctx.exception))


class ProdModeAdapterTest(unittest.TestCase):
    """Test mode prod configuration, TLS guards, credential sanitization, and central isolation."""

    def test_prod_mode_missing_dbname(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.resolve_database("5100", env="prod")
            self.assertIn("Konfigurasi database produksi untuk plant '5100' tidak ditemukan", str(ctx.exception))

    def test_prod_mode_missing_plant_code_in_connect(self):
        with self.assertRaises(etl.EtlError) as ctx:
            etl.connect_plant("mps_prod_ckp", env="prod", plant=None)
        self.assertIn("Kode plant wajib diberikan", str(ctx.exception))

    def test_prod_mode_missing_host_fails_closed(self):
        env = {
            "MPS2_PROD_PLANT_5100_DBNAME": "mps_prod_ckp",
            "MPS2_PROD_PLANT_5100_USER": "app_user",
            "MPS2_PROD_PLANT_5100_PASSWORD": "SecretPassword123",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.connect_plant("mps_prod_ckp", env="prod", plant="5100")
            self.assertIn("HOST", str(ctx.exception))

    def test_prod_mode_missing_password_fails_closed(self):
        env = {
            "MPS2_PROD_PLANT_5100_HOST": "pg-ckp.internal",
            "MPS2_PROD_PLANT_5100_DBNAME": "mps_prod_ckp",
            "MPS2_PROD_PLANT_5100_USER": "app_user",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.connect_plant("mps_prod_ckp", env="prod", plant="5100")
            self.assertIn("PASSWORD", str(ctx.exception))

    def test_prod_mode_insecure_sslmode_rejected(self):
        for bad_mode in ["disable", "allow", "prefer"]:
            env = {
                "MPS2_PROD_PLANT_5100_HOST": "pg-ckp.internal",
                "MPS2_PROD_PLANT_5100_DBNAME": "mps_prod_ckp",
                "MPS2_PROD_PLANT_5100_USER": "app_user",
                "MPS2_PROD_PLANT_5100_PASSWORD": "SecretPassword123",
                "MPS2_PROD_PLANT_5100_SSLMODE": bad_mode,
            }
            with patch.dict(os.environ, env, clear=True):
                with self.assertRaises(etl.EtlError) as ctx:
                    etl.connect_plant("mps_prod_ckp", env="prod", plant="5100")
                self.assertIn("ditolak pada mode prod", str(ctx.exception))

    def test_prod_mode_verify_full_requires_sslrootcert(self):
        env = {
            "MPS2_PROD_PLANT_5100_HOST": "pg-ckp.internal",
            "MPS2_PROD_PLANT_5100_DBNAME": "mps_prod_ckp",
            "MPS2_PROD_PLANT_5100_USER": "app_user",
            "MPS2_PROD_PLANT_5100_PASSWORD": "SecretPassword123",
            "MPS2_PROD_PLANT_5100_SSLMODE": "verify-full",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.connect_plant("mps_prod_ckp", env="prod", plant="5100")
            self.assertIn("memerlukan sertifikat root CA", str(ctx.exception))

    def test_prod_mode_credential_leak_prevention(self):
        secret_pwd = "SuperSecretPlainTextPasswordThatMustNeverLeak!@#"
        env = {
            "MPS2_PROD_PLANT_5100_HOST": "127.0.0.1",
            "MPS2_PROD_PLANT_5100_PORT": "54321",  # non-existent port
            "MPS2_PROD_PLANT_5100_DBNAME": "non_existent_db",
            "MPS2_PROD_PLANT_5100_USER": "app_user",
            "MPS2_PROD_PLANT_5100_PASSWORD": secret_pwd,
            "MPS2_PROD_PLANT_5100_SSLMODE": "require",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.connect_plant("non_existent_db", env="prod", plant="5100")
            err_msg = str(ctx.exception)
            self.assertNotIn(secret_pwd, err_msg)

    def test_prod_mode_central_unconfigured_blocks_publish(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl.connect_central(env="prod")
            err_msg = str(ctx.exception)
            self.assertIn("Koneksi direct/tunnel central staging produksi (AWS RDS) belum dikonfigurasi", err_msg)

    def test_prod_mode_central_tunnel_with_hostaddr(self):
        env = {
            "MPS2_PROD_CENTRAL_HOST": "ssb-dw-dev.cluster-chao6oi4wiuz.ap-southeast-1.rds.amazonaws.com",
            "MPS2_PROD_CENTRAL_HOSTADDR": "127.0.0.1",
            "MPS2_PROD_CENTRAL_PORT": "15432",
            "MPS2_PROD_CENTRAL_DBNAME": "ssb_dw",
            "MPS2_PROD_CENTRAL_USER": "ssb_admin",
            "MPS2_PROD_CENTRAL_PASSWORD": "SecretPassword123",
            "MPS2_PROD_CENTRAL_SSLMODE": "verify-full",
            "MPS2_PROD_CENTRAL_SSLROOTCERT": __file__,  # existing file for test
        }
        with patch.dict(os.environ, env, clear=True):
            params = etl._prod_central_conn_params()
            self.assertEqual(params["host"], "ssb-dw-dev.cluster-chao6oi4wiuz.ap-southeast-1.rds.amazonaws.com")
            self.assertEqual(params["hostaddr"], "127.0.0.1")
            self.assertEqual(params["port"], 15432)
            self.assertEqual(params["dbname"], "ssb_dw")
            self.assertEqual(params["user"], "ssb_admin")
            self.assertEqual(params["sslmode"], "verify-full")
            self.assertEqual(params["sslrootcert"], __file__)

    def test_prod_mode_central_tunnel_guard_rejects_lab_port_5432(self):
        env = {
            "MPS2_PROD_CENTRAL_HOST": "ssb-dw-dev.cluster-chao6oi4wiuz.ap-southeast-1.rds.amazonaws.com",
            "MPS2_PROD_CENTRAL_HOSTADDR": "127.0.0.1",
            "MPS2_PROD_CENTRAL_PORT": "5432",  # dangerous: lab port!
            "MPS2_PROD_CENTRAL_DBNAME": "ssb_dw",
            "MPS2_PROD_CENTRAL_USER": "ssb_admin",
            "MPS2_PROD_CENTRAL_PASSWORD": "SecretPassword123",
            "MPS2_PROD_CENTRAL_SSLMODE": "require",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl._prod_central_conn_params()
            self.assertIn("menunjuk port 5432 pada loopback (port lab lokal)", str(ctx.exception))

    def test_prod_mode_central_insecure_sslmode_rejected(self):
        for bad_mode in ["disable", "allow", "prefer"]:
            env = {
                "MPS2_PROD_CENTRAL_HOST": "ssb-dw-dev.cluster-chao6oi4wiuz.ap-southeast-1.rds.amazonaws.com",
                "MPS2_PROD_CENTRAL_HOSTADDR": "127.0.0.1",
                "MPS2_PROD_CENTRAL_PORT": "15432",
                "MPS2_PROD_CENTRAL_DBNAME": "ssb_dw",
                "MPS2_PROD_CENTRAL_USER": "ssb_admin",
                "MPS2_PROD_CENTRAL_PASSWORD": "SecretPassword123",
                "MPS2_PROD_CENTRAL_SSLMODE": bad_mode,
            }
            with patch.dict(os.environ, env, clear=True):
                with self.assertRaises(etl.EtlError) as ctx:
                    etl._prod_central_conn_params()
                self.assertIn("ditolak pada central prod", str(ctx.exception))

    def test_prod_mode_central_verify_full_requires_sslrootcert(self):
        env = {
            "MPS2_PROD_CENTRAL_HOST": "ssb-dw-dev.cluster-chao6oi4wiuz.ap-southeast-1.rds.amazonaws.com",
            "MPS2_PROD_CENTRAL_HOSTADDR": "127.0.0.1",
            "MPS2_PROD_CENTRAL_PORT": "15432",
            "MPS2_PROD_CENTRAL_DBNAME": "ssb_dw",
            "MPS2_PROD_CENTRAL_USER": "ssb_admin",
            "MPS2_PROD_CENTRAL_PASSWORD": "SecretPassword123",
            "MPS2_PROD_CENTRAL_SSLMODE": "verify-full",
        }
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(etl.EtlError) as ctx:
                etl._prod_central_conn_params()
            self.assertIn("memerlukan sertifikat root CA", str(ctx.exception))

    def test_prod_mode_both_plants_env_naming(self):
        env = {
            "MPS2_PROD_PLANT_5100_DBNAME": "mps_prod_cikupa",
            "MPS2_PROD_PLANT_5051_DBNAME": "mps_prod_balikpapan",
        }
        with patch.dict(os.environ, env, clear=True):
            self.assertEqual(etl.resolve_database("5100", env="prod"), "mps_prod_cikupa")
            self.assertEqual(etl.resolve_database("5051", env="prod"), "mps_prod_balikpapan")

    def test_prod_mode_publish_without_run_id_rejected_in_cli(self):
        env = {
            "MPS2_PROD_PLANT_5100_HOST": "127.0.0.1",
            "MPS2_PROD_PLANT_5100_PORT": "5432",
            "MPS2_PROD_PLANT_5100_DBNAME": "mps_timesheet_ckp_test",
            "MPS2_PROD_PLANT_5100_USER": "postgres",
            "MPS2_PROD_PLANT_5100_PASSWORD": "dummy",
            "MPS2_PROD_PLANT_5100_SSLMODE": "require",
        }
        with patch.dict(os.environ, env, clear=True):
            rc = etl.main(["--plant", "5100", "--env", "prod", "--publish"])
            self.assertEqual(rc, 2, "publish mode prod tanpa --run-id wajib ditolak dengan exit code 2")

    def test_prod_mode_publish_without_run_id_rejected_in_function(self):
        mock_plant = MagicMock()
        mock_central = MagicMock()
        with self.assertRaises(etl.EtlError) as ctx:
            etl.run_publish(mock_plant, mock_central, plant="5100", run_id=None, env="prod")
        self.assertIn("Mode prod pada --publish wajib menyertakan --run-id", str(ctx.exception))


class PlantConfigValidationTest(unittest.TestCase):
    """Test plant_config.plant_code matches --plant."""

    def test_load_plant_config_mismatch_fails_closed(self):
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = {
            "plant_code": "5051",
            "timezone": "Asia/Makassar",
            "sap_rules": {},
        }
        with self.assertRaises(etl.EtlError) as ctx:
            etl.load_plant_config(mock_cur, "5100")
        self.assertIn("plant diminta '5100' tetapi plant_config.plant_code='5051'", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
