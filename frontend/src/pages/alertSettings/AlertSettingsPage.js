// ตั้งค่าแจ้งเตือน — จัดการผู้รับอีเมล alert (To/CC + สถานะ active) ในตาราง alert_recipients
// ใช้ CRUD /api/alert/recipients (ADMIN/PLANNER) — Phase 6
import React, { useState, useEffect, useCallback } from 'react';
import {
  Container,
  Card,
  Table,
  Button,
  Form,
  Modal,
  Badge,
  Spinner,
  Toast,
  ToastContainer,
} from 'react-bootstrap';
import { Plus, Pencil, Trash2, Mail } from 'lucide-react';
import { apiCall } from '../../api/client';

const emptyForm = () => ({ email: '', recipient_type: 'TO', label: '' });

const AlertSettingsPage = () => {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const [editing, setEditing] = useState(null); // null | {} (add) | recipient (edit)
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // recipient to delete

  const showToast = useCallback((message, variant = 'success') => setToast({ message, variant }), []);

  const load = useCallback(() => {
    setLoading(true);
    apiCall('/alert/recipients')
      .then((res) => setRecipients(Array.isArray(res) ? res : []))
      .catch((err) => showToast(err.message, 'danger'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setForm(emptyForm());
    setEditing({});
  };
  const openEdit = (r) => {
    setForm({ email: r.email, recipient_type: r.recipient_type, label: r.label || '' });
    setEditing(r);
  };

  const save = async () => {
    if (!form.email.trim()) {
      showToast('กรุณาระบุอีเมล', 'danger');
      return;
    }
    setBusy(true);
    try {
      if (editing && editing.id) {
        await apiCall(`/alert/recipients/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        });
        showToast('✅ อัปเดตผู้รับสำเร็จ');
      } else {
        await apiCall('/alert/recipients', { method: 'POST', body: JSON.stringify(form) });
        showToast('✅ เพิ่มผู้รับสำเร็จ');
      }
      setEditing(null);
      load();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (r) => {
    try {
      await apiCall(`/alert/recipients/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !r.is_active }),
      });
      load();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await apiCall(`/alert/recipients/${confirm.id}`, { method: 'DELETE' });
      showToast('✅ ลบผู้รับสำเร็จ');
      setConfirm(null);
      load();
    } catch (err) {
      showToast(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const activeTo = recipients.filter((r) => r.is_active && String(r.recipient_type).toUpperCase() === 'TO').length;

  return (
    <Container className="pb-4" style={{ maxWidth: 900 }}>
      <h4 className="text-mse fw-bold mb-1">
        <Mail size={20} className="me-2" />
        ตั้งค่าแจ้งเตือน (ผู้รับอีเมล)
      </h4>
      <p className="text-muted small">
        รายชื่อผู้รับอีเมลแจ้งเตือน Model ที่ยังไม่มี Routing Master — To อย่างน้อย 1 รายที่ active
        จึงจะส่งได้
      </p>

      {activeTo === 0 && !loading && (
        <div className="alert alert-warning py-2 small">
          ⚠️ ยังไม่มีผู้รับประเภท <b>To</b> ที่เปิดใช้งาน — ระบบจะส่งอีเมลไม่ได้
        </div>
      )}

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-bold">ผู้รับทั้งหมด ({recipients.length})</span>
          <Button size="sm" className="btn-mse" onClick={openAdd}>
            <Plus size={14} className="me-1" />
            เพิ่มผู้รับ
          </Button>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center my-3">
              <Spinner animation="border" className="text-mse" />
            </div>
          ) : (
            <Table hover className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Email</th>
                  <th>ประเภท</th>
                  <th>ชื่อ/แผนก</th>
                  <th className="text-center">ใช้งาน</th>
                  <th className="text-end">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {recipients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-muted py-3">
                      ยังไม่มีผู้รับ — กด "เพิ่มผู้รับ"
                    </td>
                  </tr>
                ) : (
                  recipients.map((r) => (
                    <tr key={r.id}>
                      <td>{r.email}</td>
                      <td>
                        <Badge bg={String(r.recipient_type).toUpperCase() === 'CC' ? 'secondary' : 'primary'}>
                          {String(r.recipient_type).toUpperCase() === 'CC' ? 'CC' : 'To'}
                        </Badge>
                      </td>
                      <td className="text-muted">{r.label || '-'}</td>
                      <td className="text-center">
                        <Form.Check
                          type="switch"
                          checked={!!r.is_active}
                          onChange={() => toggleActive(r)}
                        />
                      </td>
                      <td className="text-end text-nowrap">
                        <Pencil
                          size={15}
                          role="button"
                          className="text-primary me-2"
                          onClick={() => openEdit(r)}
                        />
                        <Trash2
                          size={15}
                          role="button"
                          className="text-danger"
                          onClick={() => setConfirm(r)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* add/edit modal */}
      <Modal show={!!editing} onHide={() => setEditing(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }}>
            {editing && editing.id ? 'แก้ไขผู้รับ' : 'เพิ่มผู้รับ'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-2">
            <Form.Label className="small">Email</Form.Label>
            <Form.Control
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label className="small">ประเภท</Form.Label>
            <Form.Select
              value={form.recipient_type}
              onChange={(e) => setForm((f) => ({ ...f, recipient_type: e.target.value }))}
            >
              <option value="TO">To (ผู้รับหลัก)</option>
              <option value="CC">CC (สำเนา)</option>
            </Form.Select>
          </Form.Group>
          <Form.Group>
            <Form.Label className="small">ชื่อ/แผนก (ไม่บังคับ)</Form.Label>
            <Form.Control
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setEditing(null)} disabled={busy}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={save} disabled={busy}>
            บันทึก
          </Button>
        </Modal.Footer>
      </Modal>

      {/* delete confirm */}
      <Modal show={!!confirm} onHide={() => setConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.1rem' }} className="text-danger">
            ยืนยันการลบ
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>ลบผู้รับ "{confirm?.email}" ?</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirm(null)} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="danger" onClick={doDelete} disabled={busy}>
            ลบ
          </Button>
        </Modal.Footer>
      </Modal>

      <ToastContainer position="bottom-end" className="p-3">
        {toast && (
          <Toast bg={toast.variant} onClose={() => setToast(null)} show delay={3500} autohide>
            <Toast.Body className="text-white">{toast.message}</Toast.Body>
          </Toast>
        )}
      </ToastContainer>
    </Container>
  );
};

export default AlertSettingsPage;
