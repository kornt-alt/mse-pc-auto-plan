import React from 'react';
import PropTypes from 'prop-types';
import { Card, Row, Col, Form, Button } from 'react-bootstrap';
import { DATE_FILTER_FIELDS } from './orderFilters';

// แผงตัวกรองวันที่ (พับเก็บได้) — presentational ล้วน state อยู่ที่ OrderControlTower
// ต่อ 1 แถว = 1 คอลัมน์วันที่: label + จาก/ถึง (input type=date) + (ถ้า presence) มี/ไม่มี
const OrderFilterPanel = ({ filters, onChange, onReset, activeCount }) => (
  <Card className="mb-3">
    <Card.Body className="py-3">
      {DATE_FILTER_FIELDS.map((field) => {
        const fv = filters[field.key] || { from: '', to: '', has: '' };
        const rangeDisabled = fv.has === 'none';
        return (
          <Row key={field.key} className="align-items-center g-2 mb-2">
            <Col xs={12} md={2} className="fw-bold">
              {field.label}
            </Col>
            {field.presence && (
              <Col xs={6} md={2}>
                <Form.Select
                  size="sm"
                  aria-label={`${field.label} มี/ไม่มี`}
                  value={fv.has}
                  onChange={(e) => onChange(field.key, { has: e.target.value })}
                >
                  <option value="">-- ทั้งหมด --</option>
                  <option value="has">มี</option>
                  <option value="none">ไม่มี</option>
                </Form.Select>
              </Col>
            )}
            <Col xs={6} md={3}>
              <Form.Control
                type="date"
                size="sm"
                aria-label={`${field.label} จาก`}
                disabled={rangeDisabled}
                value={fv.from}
                onChange={(e) => onChange(field.key, { from: e.target.value })}
              />
            </Col>
            <Col xs="auto" className="text-muted text-center px-1">
              ถึง
            </Col>
            <Col xs={6} md={3}>
              <Form.Control
                type="date"
                size="sm"
                aria-label={`${field.label} ถึง`}
                disabled={rangeDisabled}
                value={fv.to}
                onChange={(e) => onChange(field.key, { to: e.target.value })}
              />
            </Col>
          </Row>
        );
      })}
      <div className="text-end mt-2">
        <Button
          variant="outline-secondary"
          size="sm"
          disabled={!activeCount}
          onClick={onReset}
        >
          <i className="bi bi-x-circle me-1" aria-hidden="true" />
          ล้างทั้งหมด
        </Button>
      </div>
    </Card.Body>
  </Card>
);

OrderFilterPanel.propTypes = {
  filters: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired, // (key, patch) => void
  onReset: PropTypes.func.isRequired,
  activeCount: PropTypes.number,
};

export default OrderFilterPanel;
