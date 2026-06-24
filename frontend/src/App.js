import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Navbar, Nav, Container, NavDropdown  } from 'react-bootstrap';
import About from './components/About';


import User from './components/manage_user/User'
import Login from './components/manage_user/Login';
import Logout from './components/manage_user/Logout';
import Register from './components/manage_user/Register';


import './index.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';

// const API_BASE = 'http://10.121.1.85:3202/api';
const API_BASE = 'http://localhost:5000/api';

const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...options,
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, config);
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'login';
        throw new Error('Session expired. Please log in again.');
      }
      throw new Error(data.message || 'Something went wrong');
    }

    return data;
  } catch (error) {
    throw error;
  }
};

// ProtectedRoute component to guard routes
const ProtectedRoute = ({ children }) => {
  const isAuthenticated = !!localStorage.getItem('token');
  const location = useLocation();

  return isAuthenticated ? children : <Navigate to="/login" state={{ from: location }} replace />;
};

// Component for 404 page
const NotFound = () => {
  return (
    <Container className="text-center mt-5">
      <h2>404 - Page Not Found</h2>
      <p>Sorry kub. Don't Have This Page eiei</p>
      <Link to="/">Get back Get back</Link>
    </Container>
  );
};

// ConditionalNavbar component
const ConditionalNavbar = () => {
  const location = useLocation();
  const isAuthenticated = !!localStorage.getItem('token');
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const canAccessIssue = ['ADMIN', 'ISSUE'].includes(user.role);
  const canAccessLocation = ['ADMIN', 'Common', 'IQC'].includes(user.role);
  const canAccessItemMaster = user.role === 'ADMIN';

  // Hide navbar on login and register pages
  const hideNavbarPaths = ['/login', '/register'];
  if (hideNavbarPaths.includes(location.pathname)) {
    return null;
  }

  // Only show navbar if authenticated
  if (!isAuthenticated) {
    return null;
  }

  return (
    <Navbar bg="dark" variant="dark" expand="lg" className="mb-4">
      <Container>
        <Navbar.Brand as={Link} to="/">
          Purchase Chemimal System
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav>
            {user.role === 'ADMIN' && (
              <>
                <Nav.Link as={Link} to="/user">User</Nav.Link>
              </>
            )}
            <Nav.Link as={Link} to="/about">About</Nav.Link>
            <Nav.Link as={Link} to="/logout">Logout</Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

const App = () => {
  const handleSuccess = () => {
    console.log('Registration successful or login successful');
  };

  return (
    <Router basename="/MECHA-PS-CHEM">
      <ConditionalNavbar />
      <Routes>
        <Route path="/register" element={<Register onSuccess={handleSuccess} />} />
        <Route path="/login" element={<Login onLogin={handleSuccess} />} />
        <Route path="/logout" element={<Logout />} />
        <Route
          path="/user"
          element={
            <ProtectedRoute>
              <User />
            </ProtectedRoute>
          }
        />
        <Route
          path="/about"
          element={
              <About />
          }
        />
        <Route
          path="/about"
          element={
              <About />
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

export default App;
export { apiCall, API_BASE };