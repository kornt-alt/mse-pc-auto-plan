// สร้างไฟล์ Actual Result template — เลือก batch ที่มีในแผน → ดึง (process_step, machine) ตามแผน
//   → gen แถวพร้อมกรอก qty/คน/วัน/กะ ที่ตรงแผนแน่นอน (ไม่ถูกปัดตกตอนอัปโหลด)
import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Form, Spinner, Badge, InputGroup } from 'react-bootstrap';
import { apiCall } from '../../api/client';
import { TEMPLATE_SPECS, buildActualRows, downloadRows } from '../../utils/importTemplates';

// จำกัดจำนวน batch ต่อครั้ง — backend chunk param ที่ 1000 แต่ query-string ยาวได้จำกัด (IIS/Node ~8KB)
const MAX_BATCHES = 400;

const ActualResultTemplateDialog = ({ show, onHide }) => {
  const spec = TEMPLATE_SPECS.actual_result;
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const loadBatches = useCallback(async () => {
    setLoading(true);
    setError('');
    setSelected(new Set());
    setFilter('');
    try {
      const data = await apiCall('/production/planned-batches');
      setBatches(data.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (show) loadBatches();
  }, [show, loadBatches]);

  const toggle = (b) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const visible = batches.filter((b) => b.toLowerCase().includes(filter.trim().toLowerCase()));
  const canGen = selected.size > 0 && selected.size <= MAX_BATCHES && !generating;

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      const list = [...selected];
      const q = encodeURIComponent(list.join(','));
      const res = await apiCall(`/production/plan-steps?batches=${q}`);
      const rows = buildActualRows(res.data || {});
      if (rows.length === 0) {
        setError('batch ที่เลือกไม่มี step ในแผน (schedule_results)');
        return;
      }
      downloadRows(spec, rows);
      onHide();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: '1.1rem' }}>
          <i className="bi bi-clipboard-check me-2" aria-hidden="true" />
          สร้างไฟล์ Actual Result (ตามแผน)
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <p className="small text-muted mb-2">
          เลือก batch ที่ต้องการบันทึกผลจริง — ระบบจะเติม (process_step, machine) ตามแผนให้ทุกแถว
          เหลือแค่กรอกจำนวน/พนักงาน/วัน/กะ
        </p>

        <InputGroup size="sm" className="mb-2">
          <InputGroup.Text>
            <i className="bi bi-search" aria-hidden="true" />
          </InputGroup.Text>
          <Form.Control
            placeholder="ค้นหา batch"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </InputGroup>

        <div className="d-flex align-items-center justify-content-between mb-1">
          <Form.Label className="small mb-0">
            เลือกแล้ว {selected.size}/{batches.length}
          </Form.Label>
          <div className="d-flex gap-2">
            <Button
              size="sm"
              variant="link"
              className="p-0"
              onClick={() => setSelected(new Set(visible.slice(0, MAX_BATCHES)))}
            >
              เลือกที่เห็น
            </Button>
            <Button size="sm" variant="link" className="p-0" onClick={() => setSelected(new Set())}>
              ล้าง
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-3">
            <Spinner size="sm" animation="border" />
          </div>
        ) : (
          <div className="border rounded p-2" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {visible.map((b) => (
              <Form.Check
                key={b}
                type="checkbox"
                id={`ar-batch-${b}`}
                label={b}
                checked={selected.has(b)}
                onChange={() => toggle(b)}
              />
            ))}
            {batches.length === 0 && <span className="text-muted small">ไม่พบ batch ในแผน</span>}
            {batches.length > 0 && visible.length === 0 && (
              <span className="text-muted small">ไม่พบ batch ที่ตรงกับคำค้น</span>
            )}
          </div>
        )}

        <div className="mt-3 small">
          {selected.size > MAX_BATCHES ? (
            <span className="text-danger">เลือกได้ไม่เกิน {MAX_BATCHES} batch ต่อครั้ง</span>
          ) : (
            <Badge bg={selected.size > 0 ? 'primary' : 'secondary'}>
              {selected.size} batch
            </Badge>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={generating}>
          ยกเลิก
        </Button>
        <Button className="btn-mse" disabled={!canGen} onClick={handleGenerate}>
          {generating ? (
            <Spinner size="sm" animation="border" className="me-1" />
          ) : (
            <i className="bi bi-file-earmark-excel me-1" aria-hidden="true" />
          )}
          สร้างไฟล์
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ActualResultTemplateDialog;
