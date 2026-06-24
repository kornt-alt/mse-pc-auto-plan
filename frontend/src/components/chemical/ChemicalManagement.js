import React, { useState, useEffect } from 'react';
import {
  Container, Table, Alert, Spinner, Form, InputGroup,
  Button, Modal, FormControl, FormSelect, Badge,
} from 'react-bootstrap';
import { AlertCircle, ArrowUp, ArrowDown, Edit, Trash2, Plus } from 'lucide-react';
import { apiCall } from '../../App';

const UNITS = ['L', 'mL', 'kg', 'g', 'pcs', 'bottle', 'drum', 'box'];

const emptyForm = {
  chem_code: '',
  chem_name: '',
  unit: 'L',
  stock_qty: '',
  min_qty: '',
  location: '',
  supplier: '',
};

const ChemicalManagement = () => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const isAdmin = user.role === 'ADMIN';

  const [chemicals, setChemicals] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    fetchChemicals();
  }, []);

  const fetchChemicals = async () => {
    try {
      setLoading(true);
      const data = await apiCall('/chemical');
      setChemicals(data);
      setFiltered(data);
    } catch (err) {
      setError('ไม่สามารถโหลดข้อมูลสารเคมีได้');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);
    setFiltered(
      chemicals.filter(
        (c) =>
          c.chem_code.toLowerCase().includes(term) ||
          c.chem_name.toLowerCase().includes(term) ||
          (c.location || '').toLowerCase().includes(term) ||
          (c.supplier || '').toLowerCase().includes(term)
      )
    );
  };

  const handleSort = (key) => {
    const direction = sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
    setSortConfig({ key, direction });
    setFiltered((prev) =>
      [...prev].sort((a, b) => {
        if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
        if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
        return 0;
      })
    );
  };

  const SortIcon = ({ colKey }) => {
    if (sortConfig.key !== colKey) return null;
    return sortConfig.direction === 'asc'
      ? <ArrowUp size={14} className="ms-1" />
      : <ArrowDown size={14} className="ms-1" />;
  };

  const openAddModal = () => {
    setEditTarget(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEditModal = (chem) => {
    setEditTarget(chem);
    setForm({
      chem_code: chem.chem_code,
      chem_name: chem.chem_name,
      unit: chem.unit,
      stock_qty: chem.stock_qty,
      min_qty: chem.min_qty ?? '',
      location: chem.location ?? '',
      supplier: chem.supplier ?? '',
    });
    setError('');
    setShowModal(true);
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    if (!form.chem_code.trim() || !form.chem_name.trim()) {
      setError('รหัสสารเคมีและชื่อสารเคมีห้ามว่าง');
      return;
    }
    if (form.stock_qty === '' || isNaN(Number(form.stock_qty)) || Number(form.stock_qty) < 0) {
      setError('จำนวนคงคลังต้องเป็นตัวเลขที่ไม่ติดลบ');
      return;
    }

    try {
      setSaving(true);
      setError('');
      const payload = {
        chem_code: form.chem_code.trim(),
        chem_name: form.chem_name.trim(),
        unit: form.unit,
        stock_qty: Number(form.stock_qty),
        min_qty: form.min_qty !== '' ? Number(form.min_qty) : null,
        location: form.location.trim() || null,
        supplier: form.supplier.trim() || null,
      };

      if (editTarget) {
        const res = await apiCall(`/chemical/${editTarget.chem_id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        const updated = chemicals.map((c) => (c.chem_id === editTarget.chem_id ? res.chemical : c));
        setChemicals(updated);
        setFiltered(updated.filter((c) =>
          !searchTerm ||
          c.chem_code.toLowerCase().includes(searchTerm) ||
          c.chem_name.toLowerCase().includes(searchTerm)
        ));
        setSuccess('แก้ไขข้อมูลสารเคมีสำเร็จ');
      } else {
        const res = await apiCall('/chemical', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const updated = [res.chemical, ...chemicals];
        setChemicals(updated);
        setFiltered(updated);
        setSuccess('เพิ่มสารเคมีสำเร็จ');
      }
      setShowModal(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = (chem) => {
    setDeleteTarget(chem);
    setShowDeleteModal(true);
  };

  const handleDelete = async () => {
    try {
      await apiCall(`/chemical/${deleteTarget.chem_id}`, { method: 'DELETE' });
      const updated = chemicals.filter((c) => c.chem_id !== deleteTarget.chem_id);
      setChemicals(updated);
      setFiltered(updated.filter((c) =>
        !searchTerm ||
        c.chem_code.toLowerCase().includes(searchTerm) ||
        c.chem_name.toLowerCase().includes(searchTerm)
      ));
      setSuccess('ลบสารเคมีสำเร็จ');
      setShowDeleteModal(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message || 'ลบข้อมูลไม่สำเร็จ');
      setShowDeleteModal(false);
    }
  };

  const columns = [
    { label: 'รหัส', key: 'chem_code' },
    { label: 'ชื่อสารเคมี', key: 'chem_name' },
    { label: 'หน่วย', key: 'unit' },
    { label: 'คงคลัง', key: 'stock_qty' },
    { label: 'ขั้นต่ำ', key: 'min_qty' },
    { label: 'ที่เก็บ', key: 'location' },
    { label: 'ผู้จำหน่าย', key: 'supplier' },
    ...(isAdmin ? [{ label: '', key: '' }] : []),
  ];

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" variant="primary" />
        <p className="mt-2">กำลังโหลดข้อมูล...</p>
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">จัดการสารเคมี</h2>
        {isAdmin && (
          <Button variant="primary" size="sm" onClick={openAddModal}>
            <Plus size={16} className="me-1" />เพิ่มสารเคมี
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError('')} className="d-flex align-items-center gap-2">
          <AlertCircle size={16} />{error}
        </Alert>
      )}
      {success && <Alert variant="success">{success}</Alert>}

      <InputGroup className="mb-3">
        <Form.Control
          placeholder="ค้นหาด้วยรหัส, ชื่อ, ที่เก็บ, ผู้จำหน่าย"
          value={searchTerm}
          onChange={handleSearch}
        />
        {searchTerm && (
          <Button variant="outline-secondary" onClick={() => { setSearchTerm(''); setFiltered(chemicals); }}>
            ล้าง
          </Button>
        )}
      </InputGroup>

      <Table striped bordered hover responsive>
        <thead className="table-dark">
          <tr>
            {columns.map(({ label, key }) => (
              <th
                key={key || 'actions'}
                onClick={() => key && handleSort(key)}
                style={{ cursor: key ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
              >
                {label}<SortIcon colKey={key} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-4 text-muted">
                ไม่พบข้อมูลสารเคมี
              </td>
            </tr>
          ) : (
            filtered.map((chem) => (
              <tr key={chem.chem_id}>
                <td><code>{chem.chem_code}</code></td>
                <td>{chem.chem_name}</td>
                <td>{chem.unit}</td>
                <td>
                  <Badge bg={chem.min_qty !== null && chem.stock_qty <= chem.min_qty ? 'danger' : 'success'}>
                    {Number(chem.stock_qty).toLocaleString()}
                  </Badge>
                </td>
                <td>{chem.min_qty !== null ? Number(chem.min_qty).toLocaleString() : '-'}</td>
                <td>{chem.location || '-'}</td>
                <td>{chem.supplier || '-'}</td>
                {isAdmin && (
                  <td className="text-center" style={{ whiteSpace: 'nowrap' }}>
                    <Button variant="outline-primary" size="sm" className="me-1" onClick={() => openEditModal(chem)}>
                      <Edit size={14} />
                    </Button>
                    <Button variant="outline-danger" size="sm" onClick={() => openDeleteModal(chem)}>
                      <Trash2 size={14} />
                    </Button>
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {/* Add / Edit Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>{editTarget ? 'แก้ไขสารเคมี' : 'เพิ่มสารเคมีใหม่'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && (
            <Alert variant="danger" className="d-flex align-items-center gap-2">
              <AlertCircle size={16} />{error}
            </Alert>
          )}
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>รหัสสารเคมี <span className="text-danger">*</span></Form.Label>
              <FormControl name="chem_code" value={form.chem_code} onChange={handleFormChange} placeholder="เช่น CHEM-001" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>ชื่อสารเคมี <span className="text-danger">*</span></Form.Label>
              <FormControl name="chem_name" value={form.chem_name} onChange={handleFormChange} placeholder="เช่น Hydrochloric Acid" />
            </Form.Group>
            <div className="row">
              <Form.Group className="mb-3 col-6">
                <Form.Label>หน่วย</Form.Label>
                <FormSelect name="unit" value={form.unit} onChange={handleFormChange}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </FormSelect>
              </Form.Group>
              <Form.Group className="mb-3 col-6">
                <Form.Label>จำนวนคงคลัง <span className="text-danger">*</span></Form.Label>
                <FormControl type="number" min="0" name="stock_qty" value={form.stock_qty} onChange={handleFormChange} />
              </Form.Group>
            </div>
            <div className="row">
              <Form.Group className="mb-3 col-6">
                <Form.Label>จำนวนขั้นต่ำ</Form.Label>
                <FormControl type="number" min="0" name="min_qty" value={form.min_qty} onChange={handleFormChange} placeholder="เพื่อแจ้งเตือน" />
              </Form.Group>
              <Form.Group className="mb-3 col-6">
                <Form.Label>ที่เก็บ</Form.Label>
                <FormControl name="location" value={form.location} onChange={handleFormChange} placeholder="เช่น ชั้น A-1" />
              </Form.Group>
            </div>
            <Form.Group className="mb-3">
              <Form.Label>ผู้จำหน่าย</Form.Label>
              <FormControl name="supplier" value={form.supplier} onChange={handleFormChange} placeholder="ชื่อบริษัทผู้จำหน่าย" />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>ยกเลิก</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" className="me-1" /> : null}
            บันทึก
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>ยืนยันการลบ</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          ต้องการลบ <strong>{deleteTarget?.chem_name}</strong> ({deleteTarget?.chem_code}) ออกจากระบบหรือไม่?
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>ยกเลิก</Button>
          <Button variant="danger" onClick={handleDelete}>ลบ</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default ChemicalManagement;
