import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Navbar, Nav, Container } from 'react-bootstrap';

import ProtectedRoute from './auth/ProtectedRoute';
import { isAuthenticated, getCurrentUser } from './api/client';

import Login from './components/manage_user/Login';
import Logout from './components/manage_user/Logout';
import User from './components/manage_user/User';

import './index.css';
import './theme/theme.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';

// เมนูตาม role (ตาม AppDrawer ของระบบเดิม)
// ADMIN/PLANNER: ทุกเมนู / MFG: ไม่มี Orders, Calendar / OPERATOR: Shop Floor เท่านั้น
const MENU = [
  { path: '/shop-floor', label: 'Shop Floor', roles: ['ADMIN', 'PLANNER', 'MFG', 'OPERATOR'] },
  { path: '/orders', label: 'Order Management', roles: ['ADMIN', 'PLANNER'] },
  { path: '/planning', label: 'Planning View', roles: ['ADMIN', 'PLANNER', 'MFG'] },
  { path: '/plan-actual', label: 'Plan & Actual', roles: ['ADMIN', 'PLANNER', 'MFG'] },
  { path: '/wip', label: 'WIP', roles: ['ADMIN', 'PLANNER', 'MFG'] },
  { path: '/daily-result', label: 'Daily Result', roles: ['ADMIN', 'PLANNER', 'MFG'] },
  { path: '/calendar', label: 'Calendar', roles: ['ADMIN', 'PLANNER'] },
  { path: '/routing-config', label: 'Routing Config', roles: ['ADMIN', 'PLANNER', 'MFG'] },
  { path: '/settings', label: 'Import Data', roles: ['ADMIN', 'PLANNER', 'MFG'] },
  { path: '/user', label: 'Users', roles: ['ADMIN'] },
];

const NotFound = () => (
  <Container className="text-center mt-5">
    <h2>404 - ไม่พบหน้านี้</h2>
    <Link to="/">กลับหน้าหลัก</Link>
  </Container>
);

// หน้า placeholder ระหว่างที่ยัง migrate ไม่ครบ
const ComingSoon = ({ title }) => (
  <Container className="text-center mt-5">
    <h3 className="text-mse">{title}</h3>
    <p className="text-muted">อยู่ระหว่างการพัฒนา (กำลัง migrate จากระบบเดิม)</p>
  </Container>
);

const ConditionalNavbar = () => {
  const location = useLocation();

  if (['/login'].includes(location.pathname) || !isAuthenticated()) {
    return null;
  }

  const user = getCurrentUser();
  const menuItems = MENU.filter((m) => m.roles.includes(user.role));

  return (
    <Navbar variant="dark" expand="lg" className="mb-4 navbar-mse">
      <Container fluid>
        <Navbar.Brand as={Link} to="/">
          MSE Auto Plan
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="main-navbar" />
        <Navbar.Collapse id="main-navbar">
          <Nav className="me-auto">
            {menuItems.map((m) => (
              <Nav.Link
                key={m.path}
                as={Link}
                to={m.path}
                active={location.pathname.startsWith(m.path)}
              >
                {m.label}
              </Nav.Link>
            ))}
          </Nav>
          <Nav>
            <Navbar.Text className="me-3">
              {user.username} ({user.role})
            </Navbar.Text>
            <Nav.Link as={Link} to="/logout">
              Logout
            </Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

// หน้าแรกตาม role: OPERATOR → shop floor, อื่นๆ → orders/planning
const HomeRedirect = () => {
  if (!isAuthenticated()) return <Navigate to="/login" replace />;
  const user = getCurrentUser();
  if (user.role === 'OPERATOR') return <Navigate to="/shop-floor" replace />;
  if (user.role === 'MFG') return <Navigate to="/planning" replace />;
  return <Navigate to="/orders" replace />;
};

const App = () => (
  <Router basename="/MSE-AUTO-PLAN">
    <ConditionalNavbar />
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/logout" element={<Logout />} />

      <Route
        path="/shop-floor"
        element={
          <ProtectedRoute>
            <ComingSoon title="Shop Floor Control" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER']}>
            <ComingSoon title="Order Management" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/planning"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <ComingSoon title="Planning View" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plan-actual"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <ComingSoon title="Plan & Actual" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/wip"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <ComingSoon title="WIP" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/daily-result"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <ComingSoon title="Production Daily Result" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/calendar"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER']}>
            <ComingSoon title="Calendar" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/routing-config"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <ComingSoon title="Routing & Machine Config" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <ComingSoon title="Import Data" />
          </ProtectedRoute>
        }
      />
      <Route
        path="/user"
        element={
          <ProtectedRoute roles={['ADMIN']}>
            <User />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  </Router>
);

export default App;
