// ดึง Order จาก SAP ผ่าน Hana API แล้วส่งเข้าท่ออัปโหลดเดิม (/upload/orders)
//   browser ยิง Hana เอง → map/dedupe ที่ฝั่ง client → สร้างไฟล์ CSV ในหน่วยความจำ
//   → ส่งให้ ImportPage ผ่าน onImport(file) ซึ่งจะเข้า dry-run preview + ConfirmModal ชุดเดิมทุกอย่าง
//   ⚠️ ยิงจาก browser เท่านั้น ไม่ใช่ทางเลือก: เครื่อง server อยู่ใน DMZ ไม่ถึง plb044 (ดู utils/hanaApi.js)
//      ตั้งค่าที่ frontend/.env (REACT_APP_HANA_URL + _TOKEN) — ไม่ครบ = การ์ดเตือนแล้วปิดปุ่มดึง
//
// การแบ่งงาน: ที่นี่คือ React + I/O เท่านั้น ตรรกะแปลงข้อมูลทั้งหมดอยู่ใน utils/hanaOrders.js (pure, มีเทส)
// บรรทัด new File(...) ตอนกดนำเข้าคือจุดเดียวที่แตะ Blob — เทสจะได้ไม่ต้องพึ่ง jsdom
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, Button, Form, Row, Col, Spinner, Badge, Table } from 'react-bootstrap';
import { fetchHanaOrders, hanaConfigStatus, HANA_DEFAULT_PLANT } from '../../utils/hanaApi';
import {
  buildOrderRows, buildOrdersCsvText, buildOrdersCsvMatrix, ORDER_CSV_COLUMNS,
} from '../../utils/hanaOrders';
import { exportCsv } from '../../utils/csvExport';

const PREVIEW_LIMIT = 200;   // แสดงบนจอเท่านี้ (ตารางคือคอขวด ไม่ใช่การ POST)
const MAX_IMPORT_ROWS = 5000;

const EMPTY_FILTERS = {
  plant: HANA_DEFAULT_PLANT,
  OrderType: '',
  createdOnFrom: '',
  createdOnTo: '',
  basicFinishDateFrom: '',
  basicFinishDateTo: '',
  orderNoFrom: '',
  orderNoTo: '',
  material: '',
  materialDesc: '',
  onlyHaveConfirmQty: false,
};

// ช่อง filter — ตรงตามรายการที่ API รองรับ
const FILTER_FIELDS = [
  { key: 'plant', label: 'Plant', type: 'text', placeholder: 'LB69' },
  { key: 'OrderType', label: 'Order Type', type: 'text', placeholder: 'Z101' },
  { key: 'createdOnFrom', label: 'วันที่สร้าง Batch ตั้งแต่', type: 'date' },
  { key: 'createdOnTo', label: 'ถึง', type: 'date' },
  { key: 'basicFinishDateFrom', label: 'วันที่คาดว่าเสร็จ ตั้งแต่', type: 'date' },
  { key: 'basicFinishDateTo', label: 'ถึง', type: 'date' },
  { key: 'orderNoFrom', label: 'เลข Batch ตั้งแต่', type: 'number', placeholder: '5003576805' },
  { key: 'orderNoTo', label: 'ถึง', type: 'number', placeholder: '5003600792' },
  { key: 'material', label: 'Material No.', type: 'text', placeholder: 'KT12323-2' },
  { key: 'materialDesc', label: 'Material Description', type: 'text', placeholder: 'ELEMENT' },
];

const HanaOrderCard = ({ busy, resetToken, onImport }) => {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { rows, stats }
  const [pending, setPending] = useState(0);  // จำนวนใบที่กำลังยืนยัน (ไว้บอกหลังบันทึกสำเร็จ)
  const [done, setDone] = useState(0);

  const config = useMemo(() => hanaConfigStatus(), []);

  // อัปโหลดจริงสำเร็จ → ล้างผลลัพธ์ (แพตเทิร์นเดียวกับ UploadRow) แล้วเตือนให้ Replan
  // /upload/orders ตั้งป้าย "แผนไม่เป็นปัจจุบัน" บนหน้า Orders แล้ว (เดิมเป็น quirk ที่ไม่ markEdit) แต่ผู้ใช้อยู่หน้า Import
  // ไม่เห็นป้ายนั้น — คำเตือนให้ Replan ตรงนี้จึงยังต้องมี
  useEffect(() => {
    if (resetToken > 0) {
      setResult(null);
      setError('');
      setDone(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  const setField = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const raw = await fetchHanaOrders(filters);
      setResult(buildOrderRows(raw));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const rows = result ? result.rows : [];
  const stats = result ? result.stats : null;
  const tooMany = rows.length > MAX_IMPORT_ROWS;

  // ต้องใช้ matrix ตัวเดียวกับที่ POST — ไฟล์ที่เซฟไว้จะได้อัปกลับเข้าแถว Orders ได้จริง
  const handleDownload = () => {
    exportCsv('hana_orders.csv', ORDER_CSV_COLUMNS, buildOrdersCsvMatrix(rows));
  };

  const handleImport = () => {
    const text = buildOrdersCsvText(rows);
    const file = new File([text], 'hana_orders.csv', { type: 'text/csv' });
    setPending(rows.length);
    setDone(0);
    onImport(file);
  };

  const disabled = busy || loading;

  return (
    <Card className="mt-4">
      <Card.Header className="fw-bold d-flex align-items-center justify-content-between">
        <span>
          <i className="bi bi-cloud-download me-2" aria-hidden="true" />
          ดึง Order จาก SAP (Hana API)
        </span>
        <span className="text-muted small fw-normal">
          ดึงเข้ามาแล้วยังต้องกดยืนยันอีกครั้ง เหมือนอัปโหลดไฟล์
        </span>
      </Card.Header>
      <Card.Body>
        {!config.ok && (
          <div className="alert alert-warning py-2 small" role="alert">
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            ยังตั้งค่าไม่ครบ — ขาด{' '}
            {config.missing.map((name, i) => (
              <React.Fragment key={name}>
                {i > 0 && ', '}
                <code>{name}</code>
              </React.Fragment>
            ))}{' '}
            ใน <code>frontend/.env</code> (ตั้งแล้วต้อง restart <code>npm start</code> / build ใหม่)
            ระหว่างนี้ใช้การอัปโหลดไฟล์ Orders ด้านบนแทนได้
          </div>
        )}

        {done > 0 && (
          <div className="alert alert-success py-2 small" role="status">
            <i className="bi bi-check-circle-fill me-2" aria-hidden="true" />
            นำเข้าแล้ว {done.toLocaleString()} ใบ — <strong>อย่าลืมกด Replan</strong> ที่หน้า Orders เพื่อคำนวณแผนใหม่
          </div>
        )}

        <Row className="g-2">
          {FILTER_FIELDS.map((f) => (
            <Col md={3} key={f.key}>
              <Form.Group controlId={`hana-${f.key}`}>
                <Form.Label className="small text-muted mb-1">{f.label}</Form.Label>
                <Form.Control
                  size="sm"
                  type={f.type}
                  placeholder={f.placeholder || ''}
                  value={filters[f.key]}
                  disabled={disabled}
                  onChange={(e) => setField(f.key, e.target.value)}
                />
              </Form.Group>
            </Col>
          ))}
          <Col md={3} className="d-flex align-items-end">
            <Form.Check
              id="hana-onlyHaveConfirmQty"
              type="checkbox"
              className="small mb-1"
              label="เฉพาะที่มี Confirm Qty"
              checked={filters.onlyHaveConfirmQty}
              disabled={disabled}
              onChange={(e) => setField('onlyHaveConfirmQty', e.target.checked)}
            />
          </Col>
        </Row>

        <div className="d-flex gap-2 mt-3">
          <Button className="btn-mse" size="sm" disabled={disabled || !config.ok} onClick={handleFetch}>
            {loading ? (
              <Spinner size="sm" animation="border" className="me-1" />
            ) : (
              <i className="bi bi-cloud-download me-1" aria-hidden="true" />
            )}
            ดึงข้อมูล
          </Button>
          <Button
            size="sm"
            variant="outline-secondary"
            disabled={disabled || !result}
            onClick={() => { setFilters(EMPTY_FILTERS); setResult(null); setError(''); }}
          >
            ล้างเงื่อนไข
          </Button>
        </div>

        {error && (
          <div className="alert alert-danger py-2 small mt-3 mb-0" role="alert">
            <i className="bi bi-x-circle-fill me-2" aria-hidden="true" />
            {error}
          </div>
        )}

        {stats && rows.length === 0 && (
          <div className="alert alert-info py-2 small mt-3 mb-0" role="alert">
            <i className="bi bi-info-circle me-2" aria-hidden="true" />
            {stats.fetched === 0
              ? 'ไม่พบ order ตามเงื่อนไขที่เลือก'
              : `ดึงมา ${stats.fetched} แถว แต่ไม่มีแถวไหนมีเลข Order เลย (รูปแบบข้อมูลอาจเปลี่ยน)`}
          </div>
        )}

        {stats && rows.length > 0 && (
          <div className="mt-3">
            <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
              <Badge bg="light" text="dark">ดึงมา {stats.fetched.toLocaleString()} แถว</Badge>
              <Badge bg="success">จะนำเข้า {stats.mapped.toLocaleString()} ใบ</Badge>
              {stats.duplicatesCollapsed > 0 && (
                <Badge bg="secondary">ตัดซ้ำ {stats.duplicatesCollapsed.toLocaleString()}</Badge>
              )}
              {stats.dropped > 0 && <Badge bg="secondary">ไม่มีเลข Order {stats.dropped}</Badge>}
              {stats.conflicts > 0 && (
                <Badge bg="danger" title="batch เดียวกันแต่ข้อมูลไม่ตรงกัน — ระบบเก็บใบแรกไว้">
                  ⚠ batch ซ้ำแต่ค่าต่าง {stats.conflicts}
                </Badge>
              )}
              {stats.zeroQty > 0 && (
                <Badge bg="warning" text="dark" title="qty มาจาก TotalOrderQuantity (ยอดสั่งผลิต) — แถวที่เป็น 0 คือ SAP ไม่มียอดสั่ง ควรเช็คก่อนนำเข้า">
                  ⚠ qty = 0 · {stats.zeroQty.toLocaleString()} ใบ
                </Badge>
              )}
              {stats.noSlash > 0 && (
                <Badge bg="warning" text="dark" title='ไม่พบ "/" ใน MaterialDescription — model อาจไม่ตรง'>
                  ⚠ แยก model ไม่ได้ {stats.noSlash}
                </Badge>
              )}
            </div>

            {tooMany && (
              <div className="alert alert-warning py-2 small" role="alert">
                <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
                ผลลัพธ์ {rows.length.toLocaleString()} ใบ มากเกิน {MAX_IMPORT_ROWS.toLocaleString()} — โปรดแคบช่วงวันที่ลงแล้วดึงใหม่
              </div>
            )}

            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <Table bordered size="sm" className="align-middle mb-1">
                <thead className="table-light">
                  <tr>
                    <th>batch</th><th>model</th><th>description</th><th>due_date</th><th className="text-end">qty</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_LIMIT).map((r) => (
                    <tr key={r.batch}>
                      <td className="num">{r.batch}</td>
                      <td className="num">{r.model}</td>
                      <td className="small">{r.description}</td>
                      <td className="num">{r.due_date || <span className="text-muted">-</span>}</td>
                      <td className="num text-end">{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {rows.length > PREVIEW_LIMIT && (
              <div className="text-muted small">
                แสดง {PREVIEW_LIMIT} จาก {rows.length.toLocaleString()} ใบ (นำเข้าครบทุกใบ)
              </div>
            )}

            <div className="d-flex gap-2 mt-3 align-items-center">
              <Button className="btn-mse" size="sm" disabled={disabled || tooMany} onClick={handleImport}>
                <i className="bi bi-upload me-1" aria-hidden="true" />
                ตรวจสอบและนำเข้า
              </Button>
              <Button size="sm" variant="outline-success" disabled={disabled} onClick={handleDownload}>
                <i className="bi bi-file-earmark-arrow-down me-1" aria-hidden="true" />
                ดาวน์โหลด CSV
              </Button>
              <span className="text-muted small">
                เซฟไฟล์ไว้ก่อนได้ — ถ้า session หมดอายุระหว่างยืนยัน ยังเอาไฟล์นี้ไปอัปที่แถว Orders ด้านบนได้
              </span>
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default HanaOrderCard;
