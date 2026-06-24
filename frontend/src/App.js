import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Navbar, Nav, Container, NavDropdown  } from 'react-bootstrap';
import About from './components/About';


import User from './components/manage_user/User'
import Login from './components/manage_user/Login';
import Logout from './components/manage_user/Logout';
import Register from './components/manage_user/Register';

import Add_Item_Master from './components/item-master/Add_Item_Master';
import View_Item_Master from './components/item-master/View_item_master';


import Receive from './components/Receive';
import Storage from './components/Storage';
import Issue from './components/Issue';
import History from './components/History';


import LocationOverview from './components/location/Location';
import CabinetLevelView from './components/location/CabinetLevelView';
import CabinetItemsView from './components/location/CabinetItemsView';
import LocationLayout from './components/location/LocationLayout';

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
          Purchase Tooling System
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            {canAccessItemMaster && (
              <NavDropdown title="Item master" id="item-master-dropdown">
                <NavDropdown.Item as={Link} to="/add-item-master">Add</NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/view-item-master">View</NavDropdown.Item>
              </NavDropdown>
            )}
            {/* {user.role === 'ADMIN' && (
              <>
                <Nav.Link as={Link} to="/add-item-master">Add Item Master</Nav.Link>
              </>
            )} */}
            {canAccessIssue && (
              <Nav.Link as={Link} to="/receive">Receive</Nav.Link>
            )}
            {canAccessIssue && (
              <Nav.Link as={Link} to="/issue">Issue</Nav.Link>
            )}
            <Nav.Link as={Link} to="/storage">Storage</Nav.Link>
            <Nav.Link as={Link} to="/history">History</Nav.Link>
            {canAccessLocation && (
              <Nav.Link as={Link} to="/location">Location</Nav.Link>
            )}
            {/* {canAccessLocation && (
              <NavDropdown title="Location" id="location-dropdown">
                <NavDropdown.Item as={Link} to="/location">Add Location</NavDropdown.Item>
                <NavDropdown.Item as={Link} to="/location-overview">Location Overview</NavDropdown.Item>
              </NavDropdown>
            )} */}
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
    <Router basename="/MECHATOOLINGPS">
      <ConditionalNavbar />
      <Routes>
        <Route path="/register" element={<Register onSuccess={handleSuccess} />} />
        <Route path="/login" element={<Login onLogin={handleSuccess} />} />
        <Route path="/logout" element={<Logout />} />
        <Route
          path="/add-item-master"
          element={
            <ProtectedRoute>
              <Add_Item_Master user={JSON.parse(localStorage.getItem('user') || '{}')} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/view-item-master"
          element={
            <ProtectedRoute>
              <View_Item_Master user={JSON.parse(localStorage.getItem('user') || '{}')} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/receive"
          element={
            <ProtectedRoute>
              <Receive user={JSON.parse(localStorage.getItem('user') || '{}')} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/location"
          element={
            <ProtectedRoute>
              <LocationLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<LocationOverview />} />
          <Route path=":cabinetName" element={<CabinetLevelView />} />
          <Route path=":cabinetName/:level" element={<Navigate to=".." />} />
          <Route path=":cabinetName/:level/:cabinetNo" element={<CabinetItemsView />} />
        </Route>
        <Route
          path="/user"
          element={
            <ProtectedRoute>
              <User />
            </ProtectedRoute>
          }
        />
        <Route
          path="/issue"
          element={
            <ProtectedRoute>
              <Issue user={JSON.parse(localStorage.getItem('user') || '{}')} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/storage"
          element={
            <ProtectedRoute>
              <Storage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <History />
            </ProtectedRoute>
          }
        />
        <Route
          path="/about"
          element={
            <ProtectedRoute>
              <About />
            </ProtectedRoute>
          }
        />
        {/* <Route
          path="/"
          element={
            <ProtectedRoute>
              <Navigate to="/about" replace />
            </ProtectedRoute>
          }
        /> */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              {JSON.parse(localStorage.getItem('user') || '{}')?.role === 'ADMIN' ? (
                <Navigate to="/location" replace />
              ) : (
                <Navigate to="/storage" replace />
              )}
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
};

export default App;
export { apiCall, API_BASE };