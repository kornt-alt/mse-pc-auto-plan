// Import Data — รวม 2 ทางนำเข้าข้อมูล:
//   1. Seed จากไฟล์มาตรฐานใน CSV_BASE_DIR (port settings_screen.dart — ปุ่ม 4 ตัว + status box)
//   2. อัปโหลดไฟล์ CSV จากเครื่องผู้ใช้ (แทน Tkinter upload_menu.py เดิมที่ยิง API ไม่มี auth —
//      user เลือกย้ายมาหน้าเว็บ + JWT ADMIN/PLANNER, 2026-07-17)
import React, { useState } from 'react';
import { Container, Card, Button, Form, Spinner, Modal, Table } from 'react-bootstrap';
import { Database, Upload, FileUp } from 'lucide-react';
import { apiCall } from '../../api/client';

const SEED_BUTTONS = [
  { endpoint: 'machines', label: 'Machine config', variant: 'primary' },
  { endpoint: 'routing', label: 'Routing', variant: 'secondary' },
  { endpoint: 'calendar', label: 'Calendar', variant: 'warning' },
  { endpoint: 'orders', label: 'Orders (WIP)', variant: 'success' }, // รัน SAP ก่อนอ่านไฟล์
];

const UPLOAD_ROWS = [
  { endpoint: '/upload/orders', label: 'Orders', note: 'เพิ่มเฉพาะ batch ใหม่ (append-only)' },
  { endpoint: '/upload/calendar', label: 'Calendar', note: 'แทนที่ทั้งตาราง' },
  { endpoint: '/upload/machines', label: 'Machine Config', note: 'แทนที่ทั้งตาราง' },
  { endpoint: '/upload/routing', label: 'Routing', note: 'แทนที่ทั้งตาราง' },
  {
    endpoint: '/upload/actual_result',
    label: 'Actual Result',
    note: 'ตรวจ (batch, step, machine) กับแผนก่อนบันทึก',
  },
  {
    endpoint: '/product-master/upload-csv',
    label: 'Product Master (upsert)',
    note: 'เพิ่ม/อัปเดตรายตัวตาม model',
  },
  {
    endpoint: '/upload/product_master',
    label: 'Product Master (แทนที่)',
    note: 'แทนที่ทั้งตาราง',
  },
];

// แถวอัปโหลด 1 ไฟล์ — เลือกไฟล์แล้วกดอัปโหลด (form field "file")
const UploadRow = ({ row, busy, onUpload }) => {
  const [file, setFile] = useState(null);
  const [inputKey, setInputKey] = useState(0); // เปลี่ยน key เพื่อล้าง file input หลังอัปโหลด

  const handleUpload = async () => {
    if (!file) return;
    const ok = await onUpload(row, file);
    if (ok) {
      setFile(null);
      setInputKey((k) => k + 1);
    }
  };

  return (
    <tr>
      <td className="fw-semibold">{row.label}</td>
      <td className="text-muted small">{row.note}</td>
      <td>
        <Form.Control
          key={inputKey}
          type="file"
          accept=".csv"
          size="sm"
          disabled={busy}
          onChange={(e) => setFile(e.target.files[0] ?? null)}
        />
      </td>
      <td>
        <Button size="sm" className="btn-mse" disabled={busy || !file} onClick={handleUpload}>
          <Upload size={14} className="me-1" />
          อัปโหลด
        </Button>
      </td>
    </tr>
  );
};

const ImportPage = () => {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(null); // rejected_records จาก /upload/actual_result

  const isError = status.startsWith('❌');

  // ===== seed (POST /api/seed/*) =====
  const runSeed = async (endpoint, label) => {
    setBusy(true);
    setStatus(`กำลังนำเข้า ${label}...`);
    try {
      const data = await apiCall(`/seed/${endpoint}`, { method: 'POST' });
      setStatus(data.message || '✅ สำเร็จ');
    } catch (err) {
      setStatus(`❌ พังเพราะ: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  // ===== upload (multipart) — คืน true เมื่อสำเร็จเพื่อให้แถวล้าง file input =====
  const handleUpload = async (row, file) => {
    setBusy(true);
    setStatus(`กำลังอัปโหลด ${row.label}...`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = await apiCall(row.endpoint, { method: 'POST', body: fd });
      // /product-master/upload-csv คืน 200 + status:'error' เมื่อคอลัมน์ไม่ครบ (พฤติกรรมเดิม)
      if (data.status === 'error') {
        setStatus(`❌ ${data.message}`);
        return false;
      }
      setStatus(data.message || '✅ สำเร็จ');
      if (data.rejected_records && data.rejected_records.length > 0) {
        setRejected(data.rejected_records);
      }
      return true;
    } catch (err) {
      setStatus(`❌ ${err.message}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container className="pb-4" style={{ maxWidth: 900 }}>
      <h4 className="text-mse fw-bold text-center mb-3">จัดการข้อมูลดิบ (CSV → Database)</h4>

      {/* status box */}
      <div
        className={`border rounded p-3 mb-4 text-center fw-bold ${
          isError ? 'text-danger border-danger-subtle' : 'text-success'
        }`}
        style={{ background: '#f5f5f5' }}
      >
        {busy && <Spinner size="sm" animation="border" className="me-2" />}
        {status || 'พร้อมทำงาน...'}
      </div>

      {/* ===== 1. seed จากไฟล์มาตรฐาน ===== */}
      <Card className="mb-4">
        <Card.Header className="fw-bold">
          <Database size={16} className="me-2" />
          Seed จากไฟล์มาตรฐานบน Server (CSV_BASE_DIR)
        </Card.Header>
        <Card.Body className="d-grid gap-2">
          {SEED_BUTTONS.map((b) => (
            <Button
              key={b.endpoint}
              variant={b.variant}
              disabled={busy}
              onClick={() => runSeed(b.endpoint, b.label)}
            >
              Import {b.label}
            </Button>
          ))}
        </Card.Body>
      </Card>

      {/* ===== 2. อัปโหลดไฟล์จากเครื่อง ===== */}
      <Card>
        <Card.Header className="fw-bold">
          <FileUp size={16} className="me-2" />
          อัปโหลดไฟล์ CSV จากเครื่อง
        </Card.Header>
        <Card.Body>
          <Table size="sm" borderless className="align-middle mb-0">
            <tbody>
              {UPLOAD_ROWS.map((row) => (
                <UploadRow key={row.endpoint} row={row} busy={busy} onUpload={handleUpload} />
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* ===== dialog รายการที่ถูกปัดตกจาก actual_result ===== */}
      <Modal show={!!rejected} onHide={() => setRejected(null)} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
            ⚠️ รายการที่ไม่ตรงกับแผน (ไม่ได้บันทึก)
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">
            รายการต่อไปนี้ไม่พบ (batch, step, machine) ใน schedule_results จึงไม่ถูกบันทึก
          </p>
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <Table bordered size="sm">
              <thead className="table-light">
                <tr>
                  <th>Batch</th>
                  <th>Process Step</th>
                  <th>Machine</th>
                </tr>
              </thead>
              <tbody>
                {(rejected ?? []).map((r, i) => (
                  <tr key={i}>
                    <td>{r.batch}</td>
                    <td>{r.process_step}</td>
                    <td>{r.machine}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRejected(null)}>
            ปิด
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default ImportPage;
