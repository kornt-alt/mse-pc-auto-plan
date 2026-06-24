import React, { useState, useEffect } from 'react';
import { Container, Table, Alert, Spinner, Form, InputGroup, Button, Modal, FormControl, FormSelect } from 'react-bootstrap';
import { AlertCircle, ArrowUp, ArrowDown, Edit } from 'lucide-react';
import { apiCall } from '../../App';

const User = () => {
  const [userData, setUserData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editForm, setEditForm] = useState({
    username: '',
    division: '',
    name: '',
    role: '',
    password: '',
  });

  // Predefined options
  // const divisions = ['Common', 'Common-M/P 1', 'Common-M/P 2', 'M/P 1', 'M/P 2'];
  const divisions = ['Common','M/P 1', 'M/P 2'];
  const roles = ['Common', 'IQC', 'ADMIN'];

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const data = await apiCall('/userall');
        setUserData(data);
        setFilteredData(data);
      } catch (err) {
        setError('Failed to fetch user data');
      } finally {
        setLoading(false);
      }
    };
    fetchUserData();
  }, []);

  // Handle search
  const handleSearch = (e) => {
    const term = e.target.value.toLowerCase();
    setSearchTerm(term);
    const filtered = userData.filter(
      (item) =>
        item.username.toLowerCase().includes(term) ||
        item.division.toLowerCase().includes(term) ||
        item.org.toLowerCase().includes(term) ||
        item.name.toLowerCase().includes(term)
    );
    setFilteredData(filtered);
  };

  // Handle sort
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });

    const sorted = [...filteredData].sort((a, b) => {
      if (a[key] < b[key]) return direction === 'asc' ? -1 : 1;
      if (a[key] > b[key]) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    setFilteredData(sorted);
  };

  // Reset filters
  const resetFilters = () => {
    setSearchTerm('');
    setFilteredData(userData);
    setSortConfig({ key: null, direction: 'asc' });
  };

  // Open edit modal
  const handleEditClick = (user) => {
    setSelectedUser(user);
    setEditForm({
      username: user.username,
      division: user.division,
      name: user.name,
      role: user.role,
      password: '',
    });
    setShowEditModal(true);
  };

  // Handle form changes
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setEditForm((prev) => ({
      ...prev,
      [name]: value,
      ...(name === 'division' && ['Common', 'M/P 1', 'M/P 2'].includes(value) ? { org: [] } : {}),
      // ...(name === 'division' && value === '1' ? { org: 'ENG' } : {}),
      // ...(name === 'division' && value === '2' ? { org: 'PD/RT' } : {}),
    }));
  };

  // Submit edit form
  const handleEditSubmit = async () => {
    try {
      // Validate required fields
      if (!editForm.username || !editForm.name) {
        setError('Username and name are required');
        return;
      }
      if (editForm.username.length < 3) {
        setError('Username must be at least 3 characters long');
        return;
      }
      if (editForm.password && editForm.password.length < 6) {
        setError('Password must be at least 6 characters long');
        return;
      }

      const payload = {
        username: editForm.username,
        division: editForm.division,
        name: editForm.name,
        role: editForm.role,
      };
      if (editForm.password) {
        payload.password = editForm.password;
      }

      const response = await apiCall(`/user/${selectedUser.userid}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      // Update local state
      const updatedData = userData.map((user) =>
        user.userid === selectedUser.userid ? response.user : user
      );
      setUserData(updatedData);
      setFilteredData(updatedData);
      setShowEditModal(false);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to update user');
    }
  };

  if (loading) {
    return (
      <Container className="py-8 text-center">
        <Spinner animation="border" variant="primary" />
        <p className="mt-2">Loading user data...</p>
      </Container>
    );
  }

  return (
    <Container className="py-6">
      <h2 className="text-2xl font-bold mb-4">User</h2>

      {error && (
        <Alert variant="danger" className="mb-4 d-flex align-items-center">
          <AlertCircle className="h-4 w-4 mr-2" />
          {error}
        </Alert>
      )}

      <Form className="mb-4">
        <InputGroup>
          <Form.Control
            type="text"
            placeholder="Search by Username, Division, etc."
            value={searchTerm}
            onChange={handleSearch}
          />
          <Button variant="outline-secondary" onClick={resetFilters}>
            Reset
          </Button>
        </InputGroup>
      </Form>

      <Table striped bordered hover responsive>
        <thead>
          <tr>
            {[
              { label: 'User', key: 'username' },
              { label: 'Division', key: 'division' },
              { label: 'Name', key: 'name' },
              { label: 'Role', key: 'role' },
              { label: 'Create On', key: 'created_at' },
              { label: 'Update On', key: 'updated_at' },
              { label: 'Actions', key: '' },
            ].map(({ label, key }) => (
              <th key={key} onClick={() => key && handleSort(key)} style={{ cursor: key ? 'pointer' : 'default' }}>
                {label}
                {sortConfig.key === key &&
                  (sortConfig.direction === 'asc' ? (
                    <ArrowUp className="h-4 w-4 d-inline ml-1" />
                  ) : (
                    <ArrowDown className="h-4 w-4 d-inline ml-1" />
                  ))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredData.length === 0 ? (
            <tr>
              <td colSpan="9" className="text-center py-4">
                No user data available
              </td>
            </tr>
          ) : (
            filteredData.map((item) => (
              <tr key={item.userid}>
                <td>{item.username}</td>
                <td>{item.division}</td>
                <td>{item.name}</td>
                <td>{item.role}</td>
                <td>
                  {new Date(item.created_at).toLocaleString('th-TH', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'UTC'
                  })}
                </td>
                <td>
                  {new Date(item.updated_at).toLocaleString('th-TH', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZone: 'UTC'
                  })}
                </td>
                <td>
                  <Button variant="outline-primary" size="sm" onClick={() => handleEditClick(item)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      {/* Edit Modal */}
      <Modal show={showEditModal} onHide={() => setShowEditModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit User</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <FormControl
                type="text"
                name="username"
                value={editForm.username}
                onChange={handleFormChange}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Division</Form.Label>
              <FormSelect name="division" value={editForm.division} onChange={handleFormChange}>
                {divisions.map((div) => (
                  <option key={div} value={div}>{div}</option>
                ))}
              </FormSelect>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Name</Form.Label>
              <FormControl
                type="text"
                name="name"
                value={editForm.name}
                onChange={handleFormChange}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Role</Form.Label>
              <FormSelect name="role" value={editForm.role} onChange={handleFormChange}>
                {roles.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </FormSelect>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>New Password (Optional)</Form.Label>
              <FormControl
                type="password"
                name="password"
                value={editForm.password}
                onChange={handleFormChange}
                placeholder="Leave blank to keep current password"
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleEditSubmit}>
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default User;