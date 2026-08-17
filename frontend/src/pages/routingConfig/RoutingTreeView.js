// RoutingTreeView.js — วาดมุมมองเดียว Flow > Step > เครื่อง (Alt) ของหน้า Routing Config
// ตรรกะทั้งหมดอยู่ใน routingTree.js (pure) ไฟล์นี้วาด + ส่ง event ขึ้น parent เท่านั้น
// (แบบเดียวกับ CalendarGrid.js ที่คู่กับ calendarMatrix.js)
//
// ⚠️ ชื่อไฟล์ต้องไม่ใช่ RoutingTree.js — ไฟล์ระบบของ Windows ไม่แยกตัวพิมพ์ใหญ่-เล็ก
// จะกลายเป็นไฟล์เดียวกับ routingTree.js แล้วเขียนทับกันเงียบ ๆ
import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { Card, Table, Button, Alert } from 'react-bootstrap';
import {
  flowSummary, isLastMachineOfStep, canDeleteOrphan, isLastActiveOfStep,
} from './routingTree';

// ปุ่มไอคอนเล็ก — ทุกตัวต้องมี title + aria-label (กฎของโปรเจกต์)
const IconButton = ({ icon, label, variant, onClick, disabled }) => (
  <Button
    size="sm"
    variant="link"
    className={`p-0 me-3 icon-btn ${variant}`}
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
  >
    <i className={`bi ${icon}`} aria-hidden="true" />
  </Button>
);

IconButton.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  variant: PropTypes.string,
  onClick: PropTypes.func,
  disabled: PropTypes.bool,
};

// ค่า default อยู่ใน parameter ไม่ใช่ defaultProps — React 19 ตัด defaultProps ของ function component ทิ้งแล้ว
const RoutingTreeView = ({
  tree,
  model = '',
  canEdit = false,
  wipRefs = 0,
  onMoveStep,
  onMoveFlow,
  onAddStep,
  onDeleteFlow,
  onEditStep,
  onDeleteStep,
  onAddAlt,
  onEditMachine,
  onDeleteMachine,
  onToggleActive,
}) => {
  const [collapsed, setCollapsed] = useState(() => new Set());

  const toggleFlow = useCallback((flowIndex) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(flowIndex)) next.delete(flowIndex);
      else next.add(flowIndex);
      return next;
    });
  }, []);

  const { flows, orphanMachines } = tree;

  return (
    <>
      {/* เลื่อนลำดับแล้วเลขที่ batch ตรึงไว้จะชี้คนละขั้น — เตือนก่อน ไม่บล็อก */}
      {wipRefs > 0 && (
        <Alert variant="warning" className="py-2">
          <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
          Model นี้มี <strong>{wipRefs}</strong> batch ที่ตรึงตำแหน่ง WIP ไว้ด้วยเลข Flow/Step —
          การเลื่อนลำดับจะทำให้เลขที่ตรึงไว้ชี้คนละขั้นตอน ระบบจะถามยืนยันก่อนเลื่อนทุกครั้ง
        </Alert>
      )}

      {flows.map((flow, flowPos) => {
        const { stepCount, machineCount } = flowSummary(flow);
        const isCollapsed = collapsed.has(flow.flowIndex);
        return (
          <Card className="mb-3" key={flow.flowIndex}>
            <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div className="d-flex align-items-center gap-2">
                <Button
                  size="sm"
                  variant="link"
                  className="p-0 icon-btn text-secondary"
                  title={isCollapsed ? 'ขยาย Flow นี้' : 'ย่อ Flow นี้'}
                  aria-label={isCollapsed ? `ขยาย Flow ${flow.flowIndex}` : `ย่อ Flow ${flow.flowIndex}`}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleFlow(flow.flowIndex)}
                >
                  <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-down'}`} aria-hidden="true" />
                </Button>
                <span className="fw-bold text-mse">Flow {flow.flowIndex}</span>
                <span className="chip chip-muted">
                  {stepCount} Step · {machineCount} เครื่อง
                </span>
              </div>

              {canEdit && (
                <div className="d-flex align-items-center gap-1 flex-wrap">
                  <IconButton
                    icon="bi-arrow-up"
                    label={`เลื่อน Flow ${flow.flowIndex} ขึ้น`}
                    variant="text-secondary"
                    disabled={flowPos === 0}
                    onClick={() => onMoveFlow(flow.flowIndex, 'up')}
                  />
                  <IconButton
                    icon="bi-arrow-down"
                    label={`เลื่อน Flow ${flow.flowIndex} ลง`}
                    variant="text-secondary"
                    disabled={flowPos === flows.length - 1}
                    onClick={() => onMoveFlow(flow.flowIndex, 'down')}
                  />
                  <Button size="sm" variant="outline-success" onClick={() => onAddStep(flow)}>
                    <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                    Step
                  </Button>
                  <Button size="sm" variant="outline-danger" onClick={() => onDeleteFlow(flow.flowIndex)}>
                    <i className="bi bi-trash me-1" aria-hidden="true" />
                    Flow
                  </Button>
                </div>
              )}
            </Card.Header>

            {!isCollapsed && (
              <Card.Body className="p-0">
                <Table size="sm" hover className="mb-0 align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>ขั้นตอน / เครื่องจักร</th>
                      <th className="text-end" style={{ width: 90 }}>Cycle</th>
                      <th className="text-end" style={{ width: 90 }}>Setup</th>
                      <th style={{ width: 140 }}>Jig</th>
                      <th className="text-end" style={{ width: 170 }}>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flow.steps.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-muted small text-center py-3">
                          Flow นี้ยังไม่มี Step
                        </td>
                      </tr>
                    )}

                    {flow.steps.map((step, stepPos) => (
                      <React.Fragment key={step.id ?? `${flow.flowIndex}-${step.stepIndex}`}>
                        {/* ---- แถว Step ---- */}
                        <tr className="table-light">
                          <td>
                            <span className="num text-muted me-2">Step {step.stepIndex}</span>
                            <span className="fw-bold">{step.stepName || '(ไม่มีชื่อ)'}</span>
                            {step.setupGroup ? (
                              <span className="chip chip-info ms-2">setup: {step.setupGroup}</span>
                            ) : null}
                          </td>
                          <td colSpan={3} />
                          <td className="text-end text-nowrap">
                            {canEdit && (
                              <>
                                <IconButton
                                  icon="bi-arrow-up"
                                  label={`เลื่อน Step ${step.stepName} ขึ้น`}
                                  variant="text-secondary"
                                  disabled={stepPos === 0}
                                  onClick={() => onMoveStep(step, 'up')}
                                />
                                <IconButton
                                  icon="bi-arrow-down"
                                  label={`เลื่อน Step ${step.stepName} ลง`}
                                  variant="text-secondary"
                                  disabled={stepPos === flow.steps.length - 1}
                                  onClick={() => onMoveStep(step, 'down')}
                                />
                                <IconButton
                                  icon="bi-pencil-square"
                                  label={`แก้ไข Step ${step.stepName}`}
                                  variant="text-primary"
                                  onClick={() => onEditStep(step)}
                                />
                                <IconButton
                                  icon="bi-trash"
                                  label={`ลบ Step ${step.stepName}`}
                                  variant="text-danger"
                                  onClick={() => onDeleteStep(step)}
                                />
                              </>
                            )}
                          </td>
                        </tr>

                        {/* ---- แถวเครื่องของ Step นั้น ---- */}
                        {step.machines.map((mc) => (
                          <tr
                            key={mc.id ?? `${step.stepIndex}-${mc.altIndex}`}
                            className={mc.isActive ? undefined : 'opacity-50'}
                          >
                            <td className="ps-4">
                              <i className="bi bi-arrow-return-right text-muted me-2" aria-hidden="true" />
                              <span className="num text-muted me-2">Alt {mc.altIndex}</span>
                              <span className="fw-semibold">{mc.machine}</span>
                              {!mc.isActive && <span className="chip chip-ng ms-2">ปิดใช้งาน</span>}
                            </td>
                            <td className="num text-end">{mc.cycleTime}</td>
                            <td className="num text-end">{mc.setupTime}</td>
                            <td className="num">{mc.jigId}</td>
                            <td className="text-end text-nowrap">
                              {canEdit && (
                                <>
                                  {/* เปิด/ปิด "เครื่องนี้ทำโมเดลนี้ไม่ได้ถาวร" — ทางแก้ที่ถูกต้องแทนการลบแถว
                                      (ลบแล้วเสีย cycle/setup/jig ที่ตั้งไว้ และลบตัวสุดท้ายไม่ได้)
                                      เครื่องเสียชั่วคราวใช้ปฏิทิน available_time = 0 เหมือนเดิม */}
                                  <IconButton
                                    icon={mc.isActive ? 'bi-toggle-on' : 'bi-toggle-off'}
                                    label={
                                      isLastActiveOfStep(step, mc)
                                        ? 'ปิดไม่ได้ — เป็นเครื่องสุดท้ายที่ยังใช้งานได้ของ Step นี้'
                                        : mc.isActive
                                          ? `ปิดใช้งาน ${mc.machine} (ทำโมเดลนี้ไม่ได้)`
                                          : `เปิดใช้งาน ${mc.machine}`
                                    }
                                    variant={mc.isActive ? 'text-success' : 'text-secondary'}
                                    disabled={isLastActiveOfStep(step, mc)}
                                    onClick={() => onToggleActive(mc)}
                                  />
                                  <IconButton
                                    icon="bi-pencil-square"
                                    label={`แก้ไข ${mc.machine}`}
                                    variant="text-primary"
                                    onClick={() => onEditMachine(mc)}
                                  />
                                  {/* เครื่องตัวสุดท้ายของ step ลบไม่ได้ — ตรงกับ guard ฝั่ง backend
                                      disable ตั้งแต่แรกดีกว่าปล่อยให้ไปเจอ 400 ภาษาอังกฤษ */}
                                  <IconButton
                                    icon="bi-trash"
                                    label={
                                      isLastMachineOfStep(step)
                                        ? 'ลบไม่ได้ — แต่ละ Step ต้องมีเครื่องอย่างน้อย 1 ตัว'
                                        : `ลบ ${mc.machine}`
                                    }
                                    variant="text-danger"
                                    disabled={isLastMachineOfStep(step)}
                                    onClick={() => onDeleteMachine(mc)}
                                  />
                                </>
                              )}
                            </td>
                          </tr>
                        ))}

                        {canEdit && (
                          <tr>
                            <td colSpan={5} className="ps-4 py-1 border-bottom">
                              <Button
                                size="sm"
                                variant="link"
                                className="p-0 text-success"
                                onClick={() => onAddAlt(step)}
                              >
                                <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                                เพิ่มเครื่องสำรองให้ Step {step.stepIndex}
                              </Button>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </Table>
              </Card.Body>
            )}
          </Card>
        );
      })}

      {/* เครื่องที่หลุดจาก step — ไม่ซ่อน เพราะยังอยู่ใน DB และ engine ยังอ่านอยู่ */}
      {orphanMachines.length > 0 && (
        <Card className="mb-3 border-warning">
          <Card.Header className="bg-warning-subtle fw-bold">
            <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true" />
            เครื่องที่ไม่มี Step รองรับ ({orphanMachines.length})
          </Card.Header>
          <Card.Body className="p-0">
            <p className="small text-muted px-3 pt-2 mb-2">
              แถวใน machine_config ของ {model} ที่ Flow/Step ไม่ตรงกับ Step ไหนเลย —
              เกิดจากการแก้เลข index ของสองตารางไม่ตรงกัน{' '}
              <strong>วิธีซ่อมคือกดแก้ไขแล้วเปลี่ยนเลข Flow/Step ให้ตรงกับ Step ที่มีอยู่จริง</strong>{' '}
              (ปุ่มลบใช้ไม่ได้กับแถวที่อยู่โดด ๆ เพราะ backend กันไม่ให้ลบเครื่องตัวสุดท้ายของแต่ละ Flow/Step)
            </p>
            <Table size="sm" hover className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>Flow</th>
                  <th>Step</th>
                  <th>Alt</th>
                  <th>Machine</th>
                  <th className="text-end">Cycle</th>
                  <th className="text-end">Setup</th>
                  <th>Jig</th>
                  <th className="text-end">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {orphanMachines.map((mc) => (
                  <tr key={mc.id}>
                    <td className="num">{mc.flowIndex}</td>
                    <td className="num">{mc.stepIndex}</td>
                    <td className="num">{mc.altIndex}</td>
                    <td className="fw-semibold">{mc.machine}</td>
                    <td className="num text-end">{mc.cycleTime}</td>
                    <td className="num text-end">{mc.setupTime}</td>
                    <td className="num">{mc.jigId}</td>
                    <td className="text-end text-nowrap">
                      {canEdit && (
                        <>
                          <IconButton
                            icon="bi-pencil-square"
                            label={`แก้ไข ${mc.machine}`}
                            variant="text-primary"
                            onClick={() => onEditMachine(mc)}
                          />
                          {/* แถวที่อยู่โดด ๆ ลบไม่ได้ — backend นับเครื่องต่อ (flow, step) แล้วกัน
                              ตัวสุดท้ายไว้ ซึ่ง orphan เดี่ยวเข้าเงื่อนไขนั้นเสมอ */}
                          <IconButton
                            icon="bi-trash"
                            label={
                              canDeleteOrphan(mc)
                                ? `ลบ ${mc.machine}`
                                : 'ลบไม่ได้ — เป็นเครื่องตัวเดียวของ Flow/Step นี้ ให้แก้เลข Flow/Step แทน'
                            }
                            variant="text-danger"
                            disabled={!canDeleteOrphan(mc)}
                            onClick={() => onDeleteMachine(mc)}
                          />
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {flows.length === 0 && orphanMachines.length === 0 && (
        <div className="empty-state">
          <i className="bi bi-diagram-3" aria-hidden="true" />
          <div className="fw-bold">Model นี้ยังไม่มี Routing</div>
        </div>
      )}
    </>
  );
};

RoutingTreeView.propTypes = {
  tree: PropTypes.shape({
    flows: PropTypes.array.isRequired,
    orphanMachines: PropTypes.array.isRequired,
  }).isRequired,
  model: PropTypes.string,
  canEdit: PropTypes.bool,
  wipRefs: PropTypes.number,
  onMoveStep: PropTypes.func.isRequired,
  onMoveFlow: PropTypes.func.isRequired,
  onAddStep: PropTypes.func.isRequired,
  onDeleteFlow: PropTypes.func.isRequired,
  onEditStep: PropTypes.func.isRequired,
  onDeleteStep: PropTypes.func.isRequired,
  onAddAlt: PropTypes.func.isRequired,
  onEditMachine: PropTypes.func.isRequired,
  onDeleteMachine: PropTypes.func.isRequired,
  onToggleActive: PropTypes.func.isRequired,
};

export default RoutingTreeView;
