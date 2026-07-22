import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Container,
  Table,
  Button,
  Modal,
  Form,
  Alert,
  Badge,
  Spinner,
  InputGroup,
  Row,
  Col,
} from 'react-bootstrap';
import { apiCall } from '../../api/client';
import PageHeader from '../shared/PageHeader';
import Toolbar from '../shared/Toolbar';
import ConfirmModal from '../shared/ConfirmModal';
import useCardScan from '../shared/useCardScan';

const ROLES = ['ADMIN', 'PLANNER', 'MFG', 'OPERATOR'];

const emptyForm = {
  username: '',
  password: '',
  role: 'OPERATOR',
  is_active: true,
  full_name: '',
  email: '',
  employee_code: '',
  department: '',
  phone: '',
  card_uid: '',
};

const roleBadge = (role) =>
  role === 'ADMIN' ? 'danger' : role === 'PLANNER' ? 'primary' : role === 'MFG' ? 'info' : 'secondary';

// สถานะรวม status + is_active ไว้ที่เดียว: รออนุมัติ ต้องเด่นกว่าอย่างอื่นเพราะเป็นงานที่ ADMIN ต้องทำ
const StatusChip = ({ user }) => {
  if (user.status === 'PENDING') return <span className="chip chip-warn">รออนุมัติ</span>;
  if (user.status === 'REJECTED') return <span className="chip chip-ng">ปฏิเสธแล้ว</span>;
  return user.is_active ? (
    <span className="chip chip-ok">ใช้งานอยู่</span>
  ) : (
    <span className="chip chip-muted">ระงับ</span>
  );
};

const User = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null); // null = สร้างใหม่
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [approveUser, setApproveUser] = useState(null);
  const [approveRole, setApproveRole] = useState('OPERATOR');
  const [confirm, setConfirm] = useState(null);

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

  const pendingCount = useMemo(
    () => users.filter((u) => u.status === 'PENDING').length,
    [users]
  );
  const visibleUsers = onlyPending ? users.filter((u) => u.status === 'PENDING') : users;

  const setField = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  // แตะบัตรในฟอร์มแก้ไข → เติมค่าลงช่อง card_uid
  const handleCard = useCallback((uid) => setField('card_uid', uid), []);
  const cardScan = useCardScan(handleCard);

  const openCreate = () => {
    setEditUser(null);
    setForm(emptyForm);
    cardScan.reset();
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({
      ...emptyForm,
      username: user.username,
      password: '',
      role: user.role,
      is_active: !!user.is_active,
      full_name: user.full_name || '',
      email: user.email || '',
      employee_code: user.employee_code || '',
      department: user.department || '',
      phone: user.phone || '',
      card_uid: user.card_uid || '',
    });
    cardScan.reset();
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const shared = {
        role: form.role,
        full_name: form.full_name,
        email: form.email,
        employee_code: form.employee_code,
        department: form.department,
        phone: form.phone,
        card_uid: form.card_uid,
      };
      if (editUser) {
        const body = { ...shared, is_active: form.is_active };
        if (form.password) body.password = form.password;
        await apiCall(`/users/${editUser.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await apiCall('/users', {
          method: 'POST',
          body: JSON.stringify({ ...shared, username: form.username, password: form.password }),
        });
      }
      setShowModal(false);
      setError('');
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // อนุมัติ = กำหนด role + เปิดใช้งาน + เปลี่ยนสถานะเป็น ACTIVE ในครั้งเดียว
  const handleApprove = async () => {
    setSaving(true);
    try {
      await apiCall(`/users/${approveUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ role: approveRole, status: 'ACTIVE', is_active: true }),
      });
      setApproveUser(null);
      setError('');
      fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReject = useCallback(
    async (user) => {
      try {
        await apiCall(`/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'REJECTED', is_active: false }),
        });
        setError('');
        fetchUsers();
      } catch (err) {
        setError(err.message);
      }
    },
    [fetchUsers]
  );

  const askReject = (user) =>
    setConfirm({
      title: 'ปฏิเสธคำขอใช้งาน',
      body: `ยืนยันปฏิเสธคำขอของ ${user.full_name || user.username}? ผู้ใช้จะเข้าระบบไม่ได้`,
      confirmLabel: 'ปฏิเสธคำขอ',
      variant: 'danger',
      onConfirm: () => handleReject(user),
    });

  return (
    <Container fluid className="py-3">
      <PageHeader
        icon="bi-people"
        title="จัดการผู้ใช้งาน"
        subtitle="อนุมัติคำขอ กำหนดสิทธิ์ และลงทะเบียนบัตรเข้าใช้งาน"
        status={
          pendingCount > 0 ? (
            <Badge bg="warning" text="dark">
              รออนุมัติ {pendingCount} คน
            </Badge>
          ) : null
        }
        actions={
          <Button className="btn-mse" onClick={openCreate}>
            <i className="bi bi-person-plus me-1" aria-hidden="true" /> เพิ่มผู้ใช้
          </Button>
        }
      />

      <Toolbar>
        <Form.Check
          type="switch"
          id="only-pending"
          label="แสดงเฉพาะที่รออนุมัติ"
          checked={onlyPending}
          onChange={(e) => setOnlyPending(e.target.checked)}
        />
      </Toolbar>

      {error && <Alert variant="danger">{error}</Alert>}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : visibleUsers.length === 0 ? (
        <div className="empty-state">
          <i className="bi bi-people" aria-hidden="true" />
          <div>ไม่มีผู้ใช้ตามเงื่อนไขที่เลือก</div>
        </div>
      ) : (
        <Table striped bordered hover responsive>
          <thead>
            <tr>
              <th>Username</th>
              <th>ชื่อ-นามสกุล</th>
              <th>รหัสพนักงาน</th>
              <th>แผนก</th>
              <th>อีเมล</th>
              <th>บัตร</th>
              <th>Role</th>
              <th>สถานะ</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((u) => (
              <tr key={u.id}>
                <td className="num">{u.username}</td>
                <td>{u.full_name || '-'}</td>
                <td className="num">{u.employee_code || '-'}</td>
                <td>{u.department || '-'}</td>
                <td>{u.email || '-'}</td>
                <td className="text-center">
                  {u.card_uid ? (
                    <i
                      className="bi bi-credit-card-2-front-fill"
                      title="ลงทะเบียนบัตรแล้ว"
                      aria-label="ลงทะเบียนบัตรแล้ว"
                      style={{ color: 'var(--mse-ok)' }}
                    />
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td>
                  <Badge bg={roleBadge(u.role)}>{u.role}</Badge>
                </td>
                <td>
                  <StatusChip user={u} />
                </td>
                <td className="text-center">
                  {u.status === 'PENDING' && (
                    <>
                      <Button
                        variant="success"
                        size="sm"
                        className="me-1"
                        title="อนุมัติ"
                        aria-label={`อนุมัติผู้ใช้ ${u.username}`}
                        onClick={() => {
                          setApproveUser(u);
                          setApproveRole(u.role || 'OPERATOR');
                        }}
                      >
                        <i className="bi bi-check-lg" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        className="me-1"
                        title="ปฏิเสธคำขอ"
                        aria-label={`ปฏิเสธคำขอของ ${u.username}`}
                        onClick={() => askReject(u)}
                      >
                        <i className="bi bi-x-lg" aria-hidden="true" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="outline-primary"
                    size="sm"
                    title="แก้ไข"
                    aria-label={`แก้ไขผู้ใช้ ${u.username}`}
                    onClick={() => openEdit(u)}
                  >
                    <i className="bi bi-pencil-square" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* ===== เพิ่ม / แก้ไขผู้ใช้ ===== */}
      <Modal show={showModal} onHide={() => setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{editUser ? `แก้ไขผู้ใช้: ${editUser.username}` : 'เพิ่มผู้ใช้ใหม่'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row>
            {!editUser && (
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Username</Form.Label>
                  <Form.Control
                    value={form.username}
                    onChange={(e) => setField('username', e.target.value)}
                    placeholder="ภาษาอังกฤษ/ตัวเลข เท่านั้น"
                  />
                </Form.Group>
              </Col>
            )}
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>{editUser ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'Password'}</Form.Label>
                <Form.Control
                  type="password"
                  value={form.password}
                  onChange={(e) => setField('password', e.target.value)}
                  autoComplete="new-password"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>ชื่อ-นามสกุล</Form.Label>
                <Form.Control
                  value={form.full_name}
                  onChange={(e) => setField('full_name', e.target.value)}
                  placeholder="ภาษาไทยได้"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>รหัสพนักงาน</Form.Label>
                <Form.Control
                  value={form.employee_code}
                  onChange={(e) => setField('employee_code', e.target.value)}
                  placeholder="ภาษาอังกฤษ/ตัวเลข เท่านั้น"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>อีเมล</Form.Label>
                <Form.Control
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>แผนก</Form.Label>
                <Form.Control
                  value={form.department}
                  onChange={(e) => setField('department', e.target.value)}
                  placeholder="ภาษาไทยได้"
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>เบอร์โทร</Form.Label>
                <Form.Control
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Role</Form.Label>
                <Form.Select value={form.role} onChange={(e) => setField('role', e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group className="mb-3">
                <Form.Label>ลงทะเบียนบัตร (แตะบัตรที่เครื่องอ่าน)</Form.Label>
                <InputGroup>
                  <InputGroup.Text>
                    <i className="bi bi-credit-card-2-front" aria-hidden="true" />
                  </InputGroup.Text>
                  <Form.Control
                    value={form.card_uid}
                    onChange={(e) => {
                      setField('card_uid', e.target.value);
                      cardScan.onChange(e);
                    }}
                    onKeyDown={cardScan.onKeyDown}
                    placeholder="แตะบัตร หรือพิมพ์รหัสบัตร"
                  />
                  <Button
                    variant="outline-secondary"
                    onClick={() => {
                      cardScan.reset();
                      setField('card_uid', '');
                    }}
                  >
                    ล้างบัตร
                  </Button>
                </InputGroup>
                <Form.Text className="text-muted">
                  เว้นว่าง = ผู้ใช้คนนี้ไม่มีบัตร (แตะบัตรเข้าระบบไม่ได้)
                </Form.Text>
              </Form.Group>
            </Col>
          </Row>
          {editUser && (
            <Form.Check
              type="switch"
              label="เปิดใช้งานบัญชี"
              checked={form.is_active}
              onChange={(e) => setField('is_active', e.target.checked)}
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

      {/* ===== อนุมัติคำขอ ===== */}
      <Modal show={!!approveUser} onHide={() => setApproveUser(null)}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: '1.05rem' }}>อนุมัติคำขอใช้งาน</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {approveUser && (
            <>
              <p className="mb-3">
                <strong>{approveUser.full_name || approveUser.username}</strong>
                <br />
                <span className="text-muted small">
                  Username: {approveUser.username} · รหัสพนักงาน: {approveUser.employee_code || '-'} ·
                  แผนก: {approveUser.department || '-'}
                </span>
              </p>
              <Form.Group>
                <Form.Label>กำหนดสิทธิ์การใช้งาน (Role)</Form.Label>
                <Form.Select value={approveRole} onChange={(e) => setApproveRole(e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setApproveUser(null)}>
            ยกเลิก
          </Button>
          <Button className="btn-mse" onClick={handleApprove} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'อนุมัติและเปิดใช้งาน'}
          </Button>
        </Modal.Footer>
      </Modal>

      <ConfirmModal confirm={confirm} onHide={() => setConfirm(null)} />
    </Container>
  );
};

export default User;
