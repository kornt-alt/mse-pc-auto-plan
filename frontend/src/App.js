import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { Navbar, Nav, NavDropdown, Container } from 'react-bootstrap';

import ProtectedRoute from './auth/ProtectedRoute';
import { isAuthenticated, getCurrentUser } from './api/client';
import { PlanDataProvider } from './context/PlanDataContext';

import Login from './components/manage_user/Login';
import Logout from './components/manage_user/Logout';
import User from './components/manage_user/User';
import OrderControlTower from './pages/orders/OrderControlTower';
import PlanningView from './pages/planning/PlanningView';
import CalendarPage from './pages/calendar/CalendarPage';
import ImportPage from './pages/import/ImportPage';
import ShopFloorPage from './pages/shopFloor/ShopFloorPage';
import DailyResultPage from './pages/dailyResult/DailyResultPage';
import WipPage from './pages/wip/WipPage';
import PlanActualPage from './pages/planActual/PlanActualPage';
import RoutingConfigPage from './pages/routingConfig/RoutingConfigPage';
import AlertSettingsPage from './pages/alertSettings/AlertSettingsPage';

// เมนูตาม role (ตาม AppDrawer ของระบบเดิม)
// ADMIN/PLANNER: ทุกเมนู / MFG: ไม่มี Orders, Calendar, Import / OPERATOR: Shop Floor เท่านั้น
// รายการเดี่ยว = { path, ... } / กลุ่ม dropdown = { label, items: [...] }
const MENU = [
  {
    path: '/shop-floor',
    label: 'Shop Floor',
    icon: 'bi-hdd-stack',
    roles: ['ADMIN', 'PLANNER', 'MFG', 'OPERATOR'],
  },
  { path: '/orders', label: 'Orders', icon: 'bi-list-check', roles: ['ADMIN', 'PLANNER'] },
  {
    label: 'แผนการผลิต',
    icon: 'bi-calendar3-week',
    items: [
      { path: '/planning', label: 'Planning View', icon: 'bi-grid-3x3', roles: ['ADMIN', 'PLANNER', 'MFG'] },
      { path: '/plan-actual', label: 'Plan & Actual', icon: 'bi-bar-chart-line', roles: ['ADMIN', 'PLANNER', 'MFG'] },
      { path: '/wip', label: 'WIP', icon: 'bi-box-seam', roles: ['ADMIN', 'PLANNER', 'MFG'] },
      { path: '/daily-result', label: 'Daily Result', icon: 'bi-clipboard-data', roles: ['ADMIN', 'PLANNER', 'MFG'] },
    ],
  },
  {
    label: 'ตั้งค่า',
    icon: 'bi-gear',
    items: [
      { path: '/calendar', label: 'Calendar', icon: 'bi-calendar-range', roles: ['ADMIN', 'PLANNER'] },
      { path: '/routing-config', label: 'Routing Config', icon: 'bi-signpost-split', roles: ['ADMIN', 'PLANNER', 'MFG'] },
      // Import Data เหลือ ADMIN/PLANNER — seed/upload ถูก guard role เดียวกันแล้ว (Phase 3)
      { path: '/settings', label: 'Import Data', icon: 'bi-database-up', roles: ['ADMIN', 'PLANNER'] },
      { divider: true },
      { path: '/alert-settings', label: 'ตั้งค่าแจ้งเตือน', icon: 'bi-envelope', roles: ['ADMIN', 'PLANNER'] },
      { path: '/user', label: 'ผู้ใช้งาน', icon: 'bi-people', roles: ['ADMIN'] },
    ],
  },
];

// ตรงหน้าปัจจุบันไหม — เทียบตรงตัวหรือเป็น path ย่อย เพื่อไม่ให้ /settings ไปคลุม /alert-settings
const isActivePath = (pathname, path) => pathname === path || pathname.startsWith(`${path}/`);

// กรอง role ที่ระดับรายการก่อน แล้วค่อยตัดกลุ่มที่ไม่เหลือรายการทิ้ง
const visibleMenu = (role) =>
  MENU.map((entry) => {
    if (!entry.items) return entry.roles.includes(role) ? entry : null;
    const items = entry.items.filter((it) => it.divider || it.roles.includes(role));
    // ตัด divider ที่ค้างหัว/ท้าย หรือติดกันหลังกรอง role ออก
    const cleaned = items.filter(
      (it, i) => !it.divider || (i > 0 && i < items.length - 1 && !items[i - 1].divider),
    );
    return cleaned.some((it) => !it.divider) ? { ...entry, items: cleaned } : null;
  }).filter(Boolean);

const NotFound = () => (
  <Container className="text-center mt-5">
    <div className="empty-state">
      <i className="bi bi-signpost-2" aria-hidden="true" />
      <h1 className="page-header__title justify-content-center">404 — ไม่พบหน้านี้</h1>
      <Link to="/" className="btn btn-mse mt-3">
        กลับหน้าหลัก
      </Link>
    </div>
  </Container>
);

const ConditionalNavbar = () => {
  const location = useLocation();

  if (['/login'].includes(location.pathname) || !isAuthenticated()) {
    return null;
  }

  const user = getCurrentUser();
  const menu = visibleMenu(user.role);

  return (
    <Navbar variant="dark" expand="lg" className="mb-3 navbar-mse">
      <Container fluid>
        <Navbar.Brand as={Link} to="/" className="fw-bold">
          MSE Auto Plan
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="main-navbar" />
        <Navbar.Collapse id="main-navbar">
          <Nav className="me-auto">
            {menu.map((entry) =>
              entry.items ? (
                <NavDropdown
                  key={entry.label}
                  id={`nav-${entry.label}`}
                  className={
                    entry.items.some((it) => it.path && isActivePath(location.pathname, it.path))
                      ? 'active'
                      : ''
                  }
                  title={
                    <>
                      <i className={`bi ${entry.icon} me-1`} aria-hidden="true" />
                      {entry.label}
                    </>
                  }
                >
                  {entry.items.map((it, i) =>
                    it.divider ? (
                      <NavDropdown.Divider key={`div-${i}`} />
                    ) : (
                      <NavDropdown.Item
                        key={it.path}
                        as={Link}
                        to={it.path}
                        active={isActivePath(location.pathname, it.path)}
                      >
                        <i className={`bi ${it.icon} me-2`} aria-hidden="true" />
                        {it.label}
                      </NavDropdown.Item>
                    ),
                  )}
                </NavDropdown>
              ) : (
                <Nav.Link
                  key={entry.path}
                  as={Link}
                  to={entry.path}
                  active={isActivePath(location.pathname, entry.path)}
                >
                  <i className={`bi ${entry.icon} me-1`} aria-hidden="true" />
                  {entry.label}
                </Nav.Link>
              ),
            )}
          </Nav>
          <Nav>
            <NavDropdown
              align="end"
              id="nav-user"
              title={
                <>
                  <i className="bi bi-person-circle me-1" aria-hidden="true" />
                  {user.username}
                </>
              }
            >
              <NavDropdown.ItemText className="small text-muted">
                สิทธิ์การใช้งาน: {user.role}
              </NavDropdown.ItemText>
              <NavDropdown.Divider />
              <NavDropdown.Item as={Link} to="/logout">
                <i className="bi bi-box-arrow-right me-2" aria-hidden="true" />
                ออกจากระบบ
              </NavDropdown.Item>
            </NavDropdown>
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
  <Router basename="/MSE-PC-AUTO-PLAN">
    <PlanDataProvider>
    <ConditionalNavbar />
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/logout" element={<Logout />} />

      <Route
        path="/shop-floor"
        element={
          <ProtectedRoute>
            <ShopFloorPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/orders"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER']}>
            <OrderControlTower />
          </ProtectedRoute>
        }
      />
      <Route
        path="/planning"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <PlanningView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/plan-actual"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <PlanActualPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/wip"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <WipPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/daily-result"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <DailyResultPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/calendar"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER']}>
            <CalendarPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/routing-config"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER', 'MFG']}>
            <RoutingConfigPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER']}>
            <ImportPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/alert-settings"
        element={
          <ProtectedRoute roles={['ADMIN', 'PLANNER']}>
            <AlertSettingsPage />
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
    </PlanDataProvider>
  </Router>
);

export default App;
