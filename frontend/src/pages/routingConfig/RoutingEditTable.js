// RoutingEditTable.js — ตารางแก้ในช่องได้เลยของหน้า Routing Config
// ตรรกะทั้งหมดอยู่ใน routingEdits.js (pure) ไฟล์นี้วาด + ส่ง event ขึ้น parent เท่านั้น
// (แบบเดียวกับ RoutingTreeView.js ที่คู่กับ routingTree.js)
//
// ทำไมต้องมี: การแก้ cycle/setup/jig ของทั้งโมเดลเคยต้องเปิด-ปิดไดอะล็อกทีละแถวสิบกว่ารอบ
// ตารางนี้ให้แก้ทุกช่องในหน้าเดียวแล้วกดบันทึกครั้งเดียว (ทั้งใบอยู่ใน transaction เดียวฝั่ง backend)
//
// ⚠️ ตารางนี้ **ไม่มีช่องแก้เลข flow/step/alt** โดยตั้งใจ — ลำดับขั้นแก้ด้วยปุ่ม ▲▼ ในโหมดจัดการ
// ซึ่งขยับเลขของ routing_config + machine_config พร้อมกันใน transaction เดียว
// (ดูเหตุผลเต็มที่หัว backend/utils/routingBulkEdit.js)
import React from 'react';
import PropTypes from 'prop-types';
import { Card, Table, Form, Alert, Badge, Button } from 'react-bootstrap';
import {
  editKey, fieldValue, isFieldEdited, isRowEdited,
  flowLabel, stepLabel, machineRoleLabel, rawHint,
} from './routingEdits';
import { normalizeJigList } from './jigNaming';

// ช่องที่ถูกแก้ยังไม่บันทึกขึ้นสีเหลือง — ผู้ใช้ต้องเห็นว่าอะไรค้างอยู่ก่อนกดบันทึก
const dirtyClass = (edits, key, field) =>
  (isFieldEdited(edits, key, field) ? 'bg-warning-subtle' : undefined);

// ⚠️ className ของผู้เรียก (เช่น "num") ต้อง **ผสม** กับคลาสไฮไลต์ ไม่ใช่ถูกทับ —
// ถ้าปล่อยให้ {...rest} มาทีหลังแล้วเขียนทับ ช่องตัวเลขจะไม่ขึ้นสีเหลืองตอนถูกแก้เลย
const CellInput = ({ edits, problems, rowKey, field, original, onEdit, type, className, ...rest }) => {
  const problem = problems?.[rowKey]?.[field];
  const classes = [className, dirtyClass(edits, rowKey, field), problem ? 'is-invalid' : null]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <Form.Control
        size="sm"
        type={type}
        value={fieldValue(edits, rowKey, field, original) ?? ''}
        onChange={(e) => onEdit(rowKey, field, e.target.value, original)}
        className={classes}
        {...rest}
      />
      {problem && <div className="invalid-feedback d-block small">{problem}</div>}
    </>
  );
};

CellInput.propTypes = {
  edits: PropTypes.object.isRequired,
  problems: PropTypes.object,
  rowKey: PropTypes.string.isRequired,
  field: PropTypes.string.isRequired,
  original: PropTypes.any,
  onEdit: PropTypes.func.isRequired,
  type: PropTypes.string,
  className: PropTypes.string,
};

// ช่องจิ๊กของแถว — **หนึ่งเครื่องใช้หลายจิ๊กพร้อมกันได้** (ความหมาย AND: ต้องว่างครบทุกตัว)
// โชว์เป็นชิปเรียงกัน ตัวแรกคือจิ๊กหลัก (ลงคอลัมน์ machine_config.jig_id) ที่เหลือเป็นจิ๊กเสริม
//
// ⚠️ is_shared เปลี่ยนแค่ป้ายในตัวเลือก **ไม่ได้กรองรายการ** (GET /jig คืนแค่จำนวนที่ใช้อยู่
// ไม่ได้คืนรายชื่อโมเดล) ตัวที่กันความผิดพลาดจริงคือคำเตือนตอนกดบันทึก ไม่ใช่การกรอง
const JigCell = ({ edits, rowKey, original, jigs, onEdit, disabled }) => {
  const list = Array.isArray(jigs) ? jigs : [];
  const picked = normalizeJigList(fieldValue(edits, rowKey, 'jig_ids', original));
  const dirty = isFieldEdited(edits, rowKey, 'jig_ids');

  const setPicked = (next) => onEdit(rowKey, 'jig_ids', normalizeJigList(next), original);
  const remove = (jig) => setPicked(picked.filter((j) => j !== jig));
  const add = (jig) => {
    const v = String(jig ?? '').trim();
    if (!v || picked.includes(v)) return;
    setPicked([...picked, v]);
  };

  const remaining = list.filter((j) => !picked.includes(j.jig_id));

  return (
    <div className={dirty ? 'p-1 rounded bg-warning-subtle' : undefined}>
      <div className="d-flex flex-wrap gap-1 mb-1">
        {picked.length === 0 ? (
          <span className="text-muted small">— ตั้งชื่อให้อัตโนมัติ</span>
        ) : (
          picked.map((j) => (
            <span key={j} className="chip chip-info d-inline-flex align-items-center gap-1">
              {j}
              {!disabled && (
                <Button
                  size="sm"
                  variant="link"
                  className="p-0 lh-1 text-danger"
                  title={`เอา ${j} ออก`}
                  aria-label={`เอาจิ๊ก ${j} ออกจากแถวนี้`}
                  onClick={() => remove(j)}
                >
                  <i className="bi bi-x" aria-hidden="true" />
                </Button>
              )}
            </span>
          ))
        )}
      </div>

      {!disabled && (
        list.length > 0 ? (
          <Form.Select
            size="sm"
            value=""
            onChange={(e) => add(e.target.value)}
            aria-label="เพิ่มจิ๊ก"
          >
            <option value="">+ เพิ่มจิ๊ก…</option>
            {remaining.map((j) => (
              <option key={j.jig_id} value={j.jig_id}>
                {j.jig_id}
                {j.jig_name ? ` — ${j.jig_name}` : ''}
                {j.is_shared ? ' (ใช้ร่วมกันได้)' : ''}
              </option>
            ))}
          </Form.Select>
        ) : (
          // ยังไม่ได้รันคำสั่งสร้างทะเบียนจิ๊ก → กลับไปเป็นช่องพิมพ์ ไม่ขวางการทำงาน
          <Form.Control
            size="sm"
            placeholder="พิมพ์รหัสจิ๊กแล้ว Enter"
            aria-label="เพิ่มจิ๊ก"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              add(e.target.value);
              e.target.value = '';
            }}
          />
        )
      )}
    </div>
  );
};

JigCell.propTypes = {
  edits: PropTypes.object.isRequired,
  rowKey: PropTypes.string.isRequired,
  original: PropTypes.array,
  jigs: PropTypes.array,
  onEdit: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
};

// ค่า default อยู่ใน parameter ไม่ใช่ defaultProps — React 19 ตัด defaultProps ของ function component ทิ้งแล้ว
const RoutingEditTable = ({
  groups,
  orphanGroup,
  edits,
  problems = {},
  machines: machineList = [],
  jigs = [],
  canEdit = false,
  onEdit,
}) => {
  const machineOptions = Array.isArray(machineList) ? machineList : [];

  // แถวเครื่องหนึ่งแถว — ใช้ซ้ำทั้งกลุ่มปกติและกลุ่มที่ยังไม่ผูกขั้นตอน
  const machineRow = (g, m, first, rowSpan) => {
    const rowKey = editKey('machine', m.id);
    const active = !!fieldValue(edits, rowKey, 'is_active', m.isActive);
    return (
      <tr key={m.id} className={active ? undefined : 'opacity-75'}>
        {first && (
          <td rowSpan={rowSpan} className="align-middle" style={{ minWidth: 210 }}>
            {g.stepId != null ? (
              <>
                <div className="small text-muted">
                  {flowLabel(g.flowPos)} · {stepLabel(g.stepPos)}
                </div>
                <CellInput
                  edits={edits}
                  problems={problems}
                  rowKey={editKey('step', g.stepId)}
                  field="step_name"
                  original={g.stepName}
                  onEdit={onEdit}
                  disabled={!canEdit}
                  aria-label={`ชื่อ${stepLabel(g.stepPos)}`}
                />
              </>
            ) : (
              <span className="fw-semibold text-warning-emphasis">{g.stepName}</span>
            )}
          </td>
        )}

        <td style={{ minWidth: 150 }}>
          <div className="small text-muted">
            {g.isOrphan ? rawHint(m.flowIndex, m.stepIndex, m.altIndex) : machineRoleLabel(m.altPos)}
          </div>
          {machineOptions.length > 0 ? (
            <Form.Select
              size="sm"
              value={fieldValue(edits, rowKey, 'machine', m.machine) ?? ''}
              onChange={(e) => onEdit(rowKey, 'machine', e.target.value, m.machine)}
              className={`${dirtyClass(edits, rowKey, 'machine') ?? ''} ${problems?.[rowKey]?.machine ? 'is-invalid' : ''}`}
              disabled={!canEdit}
              aria-label="เครื่องจักร"
            >
              <option value="">-- เลือกเครื่อง --</option>
              {/* รหัสเดิมที่ไม่มีในรายชื่อเครื่องต้องยังเลือกอยู่ได้ ไม่งั้นการแก้ช่องอื่นจะเปลี่ยนเครื่องทิ้งเงียบ ๆ */}
              {!machineOptions.includes(m.machine) && m.machine ? (
                <option value={m.machine}>{m.machine} (ไม่มีในรายชื่อเครื่อง)</option>
              ) : null}
              {machineOptions.map((mc) => (
                <option key={mc} value={mc}>{mc}</option>
              ))}
            </Form.Select>
          ) : (
            <CellInput
              edits={edits}
              problems={problems}
              rowKey={rowKey}
              field="machine"
              original={m.machine}
              onEdit={onEdit}
              disabled={!canEdit}
              aria-label="เครื่องจักร"
            />
          )}
        </td>

        <td style={{ width: 120 }}>
          <CellInput
            edits={edits}
            problems={problems}
            rowKey={rowKey}
            field="cycle_time"
            original={m.cycleTime}
            onEdit={onEdit}
            type="number"
            min="0"
            step="any"
            disabled={!canEdit}
            className="num"
            aria-label="เวลาต่อชิ้น (นาที)"
          />
        </td>

        <td style={{ width: 120 }}>
          <CellInput
            edits={edits}
            problems={problems}
            rowKey={rowKey}
            field="setup_time"
            original={m.setupTime}
            onEdit={onEdit}
            type="number"
            min="0"
            step="any"
            disabled={!canEdit}
            className="num"
            aria-label="เวลาตั้งเครื่อง (นาที)"
          />
        </td>

        <td style={{ minWidth: 190 }}>
          <JigCell
            edits={edits}
            rowKey={rowKey}
            original={m.jigIds}
            jigs={jigs}
            disabled={!canEdit}
            onEdit={onEdit}
          />
        </td>

        <td className="text-center" style={{ width: 90 }}>
          <Form.Check
            type="switch"
            checked={active}
            disabled={!canEdit}
            onChange={(e) => onEdit(rowKey, 'is_active', e.target.checked, m.isActive)}
            title={active ? 'เครื่องนี้ทำโมเดลนี้ได้' : 'ปิดไว้ — ระบบจะไม่วางแผนลงเครื่องนี้'}
            aria-label={`ใช้งาน ${m.machine}`}
          />
        </td>

        <td className="text-center" style={{ width: 60 }}>
          {isRowEdited(edits, rowKey) && (
            <Badge bg="warning" text="dark" title="แถวนี้ยังไม่ได้บันทึก">แก้แล้ว</Badge>
          )}
        </td>
      </tr>
    );
  };

  const header = (
    <thead className="table-light">
      <tr>
        <th>ขั้นตอน</th>
        <th>เครื่องจักร</th>
        <th>เวลาต่อชิ้น (นาที)</th>
        <th>เวลาตั้งเครื่อง (นาที)</th>
        <th style={{ minWidth: 190 }}>จิ๊กที่ต้องใช้</th>
        <th className="text-center">ใช้งาน</th>
        <th className="text-center">สถานะ</th>
      </tr>
    </thead>
  );

  return (
    <>
      <Card className="mb-3">
        <Card.Body className="p-0">
          <div className="matrix-scroll">
            <Table size="sm" className="mb-0 align-middle">
              {header}
              <tbody>
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-muted small text-center py-3">
                      Model นี้ยังไม่มีขั้นตอนการผลิต
                    </td>
                  </tr>
                )}
                {groups.map((g) => {
                  if (g.machines.length === 0) {
                    return (
                      <tr key={g.key}>
                        <td style={{ minWidth: 210 }}>
                          <div className="small text-muted">
                            {flowLabel(g.flowPos)} · {stepLabel(g.stepPos)}
                          </div>
                          <CellInput
                            edits={edits}
                            problems={problems}
                            rowKey={editKey('step', g.stepId)}
                            field="step_name"
                            original={g.stepName}
                            onEdit={onEdit}
                            disabled={!canEdit}
                            aria-label={`ชื่อ${stepLabel(g.stepPos)}`}
                          />
                        </td>
                        <td colSpan={6} className="text-muted small">
                          ขั้นนี้ยังไม่มีเครื่องจักร — เพิ่มได้ในโหมดจัดการลำดับ
                        </td>
                      </tr>
                    );
                  }
                  return g.machines.map((m, i) => machineRow(g, m, i === 0, g.machines.length));
                })}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>

      {/* แถวที่ยังไม่ผูกขั้นตอน — ไม่ซ่อน เพราะยังอยู่ใน DB และ engine ยังอ่านอยู่
          แก้ค่าที่นี่ได้ แต่การ "ซ่อม" ให้กลับไปผูกขั้นตอนต้องแก้เลขดิบในโหมดจัดการลำดับ */}
      {orphanGroup && (
        <Card className="mb-3 border-warning">
          <Card.Header className="bg-warning-subtle fw-bold">
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            เครื่องที่ยังไม่ผูกกับขั้นตอนไหน ({orphanGroup.machines.length})
          </Card.Header>
          <Card.Body className="p-0">
            <Alert variant="light" className="small mb-0 rounded-0 border-0 border-bottom">
              แถวเหล่านี้ระบบยังนำไปคำนวณแผนอยู่ แต่จับคู่กับขั้นตอนไหนไม่ได้ —
              แก้ค่าได้จากตรงนี้ ส่วนการผูกกลับเข้าขั้นตอนต้องเข้า
              <strong> โหมดจัดการลำดับ </strong>
              แล้วแก้เลขกำกับ (เลขดิบแสดงไว้ในช่องเครื่องจักรแล้ว)
            </Alert>
            <div className="matrix-scroll">
              <Table size="sm" className="mb-0 align-middle">
                {header}
                <tbody>
                  {orphanGroup.machines.map((m, i) =>
                    machineRow(orphanGroup, m, i === 0, orphanGroup.machines.length))}
                </tbody>
              </Table>
            </div>
          </Card.Body>
        </Card>
      )}
    </>
  );
};

RoutingEditTable.propTypes = {
  groups: PropTypes.array.isRequired,
  orphanGroup: PropTypes.object,
  edits: PropTypes.object.isRequired,
  problems: PropTypes.object,
  machines: PropTypes.array,
  jigs: PropTypes.array,
  canEdit: PropTypes.bool,
  onEdit: PropTypes.func.isRequired,
};

export default RoutingEditTable;
