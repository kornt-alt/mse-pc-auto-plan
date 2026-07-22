import React, { useState, useEffect, useCallback } from 'react';
import { Container, Table, Button, Modal, Form, Alert, Badge, Spinner } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../shared/PageHeader';

const ROLES = ['ADMIN', 'PLANNER', 'MFG', 'OPERATOR'];

const emptyForm = { username: '', password: '', role: 'OPERATOR', is_active: true };

const User = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null); // null = สร้างใหม่
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall('/users');
      setUsers(data);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({ username: user.username, password: '', role: user.role, is_active: !!user.is_active });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editUser) {
        const body = { role: form.role, is_active: form.is_active };
        if (form.password) body.password = form.password;
        await apiCall(`/users/${editUser.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiCall('/users', {
          method: 'POST',
          body: JSON.stringify({ username: form.username, password: form.password, role: form.role }),
        });
      }
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container className="py-3">
      <PageHeader
        icon="bi-people"
        title="จัดการผู้ใช้งาน"
        subtitle="เพิ่ม แก้ไข และระงับสิทธิ์การเข้าใช้ระบบ"
        actions={
          <Button className="btn-mse" onClick={openCreate}>
            <i className="bi bi-person-plus me-1" aria-hidden="true" /> เพิ่มผู้ใช้
          </Button>
        }
      />

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>#</th>
              <th>Username</th>
              <th>Role</th>
              <th>สถานะ</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.username}</td>
                <td>
                  <Badge
                    bg={
                      u.role === 'ADMIN'
                        ? 'danger'
                        : u.role === 'PLANNER'
                        ? 'primary'
                        : u.role === 'MFG'
                        ? 'info'
                        : 'secondary'
                    }
                  >
                    {u.role}
                  </Badge>
                </td>
                <td>
                  {u.is_active ? <span className="chip chip-ok">ใช้งานอยู่</span> : <span className="chip chip-muted">ระงับ</span>}
                </td>
                <td className="text-center">
                  <Button variant="outline-primary" size="sm" title="แก้ไข" aria-label={`แก้ไขผู้ใช้ ${u.username}`} onClick={() => openEdit(u)}>
                    <i className="bi bi-pencil-square" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>{editUser ? `แก้ไขผู้ใช้: ${editUser.username}` : 'เพิ่มผู้ใช้ใหม่'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!editUser && (
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="รหัสพนักงาน / ชื่อผู้ใช้"
              />
            </Form.Group>
          )}
          <Form.Group className="mb-3">
            <Form.Label>{editUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'Password'}</Form.Label>
            <Form.Control
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Role</Form.Label>
            <Form.Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
          {editUser && (
            <Form.Check
              type="switch"
              label="เปิดใช้งานบัญชี"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
            />
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'บันทึก'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default User;
