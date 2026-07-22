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
} from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../../components/shared/PageHeader';
import ToastHost, { useToast } from '../../components/shared/ToastHost';

const emptyForm = () => ({ email: '', recipient_type: 'TO', label: '' });

const AlertSettingsPage = () => {
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState(null); // null | {} (add) | recipient (edit)
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // recipient to delete

  const { toast, showToast, hideToast } = useToast();

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
        showToast('อัปเดตผู้รับแล้ว');
      } else {
        await apiCall('/alert/recipients', { method: 'POST', body: JSON.stringify(form) });
        showToast('เพิ่มผู้รับแล้ว');
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
      showToast('ลบผู้รับแล้ว');
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
      <PageHeader
        icon="bi-envelope"
        title="ตั้งค่าแจ้งเตือน"
        subtitle="ผู้รับอีเมลแจ้งเตือน Model ที่ยังไม่มี Routing Master — ต้องมีผู้รับประเภท To ที่เปิดใช้งานอย่างน้อย 1 ราย"
      />

      {activeTo === 0 && !loading && (
        <div className="alert alert-warning py-2 small d-flex align-items-center gap-2">
          <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
          <span>
            ยังไม่มีผู้รับประเภท <b>To</b> ที่เปิดใช้งาน — ระบบจะส่งอีเมลไม่ได้
          </span>
        </div>
      )}

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-bold">ผู้รับทั้งหมด ({recipients.length})</span>
          <Button size="sm" className="btn-mse" onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true" />
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
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 me-3 text-primary icon-btn"
                          title="แก้ไขผู้รับ"
                          aria-label={`แก้ไขผู้รับ ${r.email}`}
                          onClick={() => openEdit(r)}
                        >
                          <i className="bi bi-pencil-square" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0 text-danger icon-btn"
                          title="ลบผู้รับ"
                          aria-label={`ลบผู้รับ ${r.email}`}
                          onClick={() => setConfirm(r)}
                        >
                          <i className="bi bi-trash" aria-hidden="true" />
                        </Button>
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

      <ToastHost toast={toast} onClose={hideToast} />
    </Container>
  );
};

export default AlertSettingsPage;
