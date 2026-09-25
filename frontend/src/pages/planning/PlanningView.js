// Planning View — ภาพรวมแผนล่าสุดสำหรับ PC / MC / หัวหน้างาน (ปรับใหม่ 2026-09-25 — เดิม port 1:1 จาก dashboard_screen.dart)
//
// โครง: PageHeader (+ ปุ่มรายงานแผนทั้งชุด) → KPI → แท็บ เรียงตาม flow งาน
//   Delivery · Late / At-risk · Schedule · Dispatch List · Load · Material
// - planData / reportData มาจาก PlanDataContext (cache แบบ Flutter)
// - GET /orders ดึงครั้งเดียวตอนเปิดหน้า แล้วส่งให้ KPI / Late / Material (เดิม 2 แท็บยิงแยกกันตอนเปิดแท็บ)
// - filter ของ Schedule ถือไว้ที่นี่ เพื่อให้แท็บ Load กดส่งเครื่อง/สัปดาห์มาเปิดใน Schedule ได้
// - แท็บอื่นถือ filter ของตัวเอง และคงอยู่เพราะ Tabs ไม่ unmount แท็บที่ไม่ active
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Container, Tabs, Tab, Spinner, Button } from 'react-bootstrap';
import { usePlanData } from '../../context/PlanDataContext';
import { apiCall, getCurrentUser } from '../../api/client';
import DeliveryTab from './DeliveryTab';
import LateRiskTab from './LateRiskTab';
import ScheduleTab from './ScheduleTab';
import DispatchTab from './DispatchTab';
import LoadTab from './LoadTab';
import MaterialShortageTab from './MaterialShortageTab';
import PageHeader from '../../components/shared/PageHeader';
import { KpiStrip } from '../../components/report';
import { buildPlanKpis, DEFAULT_RISK_DAYS, DEFAULT_MAT_WINDOW } from './planKpis';
import { buildDeliveryRows } from './delivery';
import { buildLateRiskRows } from './lateRisk';
import { buildWeeklyLoad } from './weeklyLoad';
import { buildShortageRows } from './materialShortage';
import { buildDispatchList, flattenDispatch } from './dispatchList';
import {
  summarySheet, deliverySheet, lateSheet, loadSheet, materialSheet, dispatchSheet,
} from './planReport';
import { exportWorkbook, stampedFilename } from '../../utils/xlsxExport';
import { todayBangkok, addDays, nowBangkokLabel } from '../../utils/dates';

const PlanningView = () => {
  const { planData, reportData, prevReportData, loading, loadLatest } = usePlanData();
  const today = todayBangkok();
  const [activeTab, setActiveTab] = useState('delivery');
  const [scheduleFilter, setScheduleFilter] = useState({ machine: null, batch: null, from: today, to: addDays(today, 13) });
  const [orders, setOrders] = useState(null);
  const [ordersError, setOrdersError] = useState('');
  const [lastPlan, setLastPlan] = useState('');

  // กู้คืนข้อมูลหลัง refresh — เรียกเฉพาะตอนยังไม่มีข้อมูล (dashboard_screen.dart L70-72)
  useEffect(() => {
    if (planData === null) loadLatest();
  }, [planData, loadLatest]);

  const loadOrders = useCallback(async () => {
    setOrdersError('');
    try {
      const data = await apiCall('/orders');
      setOrders(Array.isArray(data) ? data : []);
    } catch (e) {
      setOrdersError(e.message || 'โหลดรายการออเดอร์ไม่สำเร็จ');
      setOrders([]);
    }
    try {
      const ts = await apiCall('/system/timestamps');
      setLastPlan(ts?.last_plan && ts.last_plan !== '-' ? ts.last_plan : '');
    } catch {
      /* ไม่มีเวลาแผนก็แสดงรายงานได้ */
    }
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const kpis = useMemo(
    () => (planData ? buildPlanKpis({ planData, reportData, orders, todayStr: today }) : null),
    [planData, reportData, orders, today],
  );

  const openSchedule = useCallback((machine, weekStart) => {
    setScheduleFilter({ machine, batch: null, from: weekStart, to: addDays(weekStart, 6) });
    setActiveTab('schedule');
  }, []);

  const asOf = lastPlan || undefined;

  // รายงานแผนทั้งชุด — ทุกชีตใช้ค่าตั้งต้นของแต่ละแท็บ (ไม่ขึ้นกับ filter ที่กดค้างไว้บนจอ)
  const handleFullReport = () => {
    const u = getCurrentUser();
    const meta = {
      title: 'รายงานแผนการผลิต (Plan Report)',
      asOf: lastPlan || '-',
      exportedAt: nowBangkokLabel(),
      user: u.full_name || u.username || '',
    };
    const load = buildWeeklyLoad(planData);
    const dispatchTo = addDays(today, 6);
    exportWorkbook(stampedFilename('plan_report', today), [
      summarySheet(kpis),
      { ...deliverySheet(buildDeliveryRows(reportData, prevReportData)), meta: { ...meta, filters: 'ทุก batch ในแผน' } },
      { ...lateSheet(buildLateRiskRows(reportData, orders ?? [], today, DEFAULT_RISK_DAYS)), meta: { ...meta, filters: `เฉียดกำหนด ≤ ${DEFAULT_RISK_DAYS} วัน` } },
      { ...loadSheet(load.weeks, load.rows), meta: { ...meta, filters: 'ทุกเครื่องที่มีงาน (%)' } },
      { ...materialSheet(buildShortageRows(orders ?? [], today, DEFAULT_MAT_WINDOW)), meta: { ...meta, filters: `เริ่มภายใน ${DEFAULT_MAT_WINDOW} วัน` } },
      {
        ...dispatchSheet(flattenDispatch(buildDispatchList(planData, { from: today, to: dispatchTo }))),
        meta: { ...meta, filters: `${today} ถึง ${dispatchTo}` },
      },
    ], meta);
  };

  if (loading || planData === null) {
    return (
      <Container fluid className="text-center py-5">
        <Spinner animation="border" className="text-mse" />
      </Container>
    );
  }

  // ออเดอร์ยังโหลดไม่เสร็จหรือโหลดพัง = ตัวเลขที่ใช้ orders ยังไม่รู้ — ห้ามโชว์ 0 สีเขียว (อ่านว่า "ไม่มีปัญหา")
  const ordersOk = orders !== null && !ordersError;
  const kpiItems = kpis ? [
    { id: 'delivery', label: 'Batch ในแผน', value: kpis.batches, tone: 'info' },
    { id: 'late', label: 'ช้า / หลุดแผน', value: ordersOk ? kpis.late + kpis.unplanned : '…', sub: ordersOk ? `หลุดแผน ${kpis.unplanned}` : null, tone: !ordersOk ? 'muted' : kpis.late + kpis.unplanned > 0 ? 'ng' : 'ok' },
    { id: 'late-risk', label: `เฉียดกำหนด (≤ ${DEFAULT_RISK_DAYS} วัน)`, value: ordersOk ? kpis.atRisk : '…', tone: !ordersOk ? 'muted' : kpis.atRisk > 0 ? 'warn' : 'ok' },
    { id: 'load', label: 'Load สูงสุดสัปดาห์นี้', value: kpis.peakPct == null ? '-' : `${kpis.peakPct}%`, sub: kpis.peakMachine || null, tone: kpis.peakPct == null ? 'muted' : kpis.peakPct > 90 ? 'ng' : kpis.peakPct >= 70 ? 'warn' : 'ok' },
    { id: 'load-busy', label: 'เครื่อง > 90%', value: kpis.busyMachines, tone: kpis.busyMachines > 0 ? 'ng' : 'ok' },
    { id: 'material', label: `ของยังไม่เข้า (${DEFAULT_MAT_WINDOW} วัน)`, value: ordersOk ? kpis.matShort : '…', tone: !ordersOk ? 'muted' : kpis.matShort > 0 ? 'warn' : 'ok' },
  ] : [];
  const KPI_TAB = { delivery: 'delivery', late: 'late', 'late-risk': 'late', load: 'load', 'load-busy': 'load', material: 'material' };

  return (
    <Container fluid className="px-3">
      <PageHeader
        icon="bi-grid-3x3"
        title="Planning View"
        subtitle="ภาพรวมแผนล่าสุด: กำหนดส่ง · ออเดอร์ที่ต้องตาม · แผนรายเครื่อง · ภาระเครื่อง · ของเข้า"
        status={lastPlan ? <span className="small text-muted num">แผน ณ {lastPlan}</span> : null}
        actions={(
          <>
            <Button size="sm" variant="outline-secondary" onClick={loadOrders} title="โหลดรายการออเดอร์ใหม่">
              <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />รีเฟรช
            </Button>
            <Button size="sm" className="btn-mse" onClick={handleFullReport} disabled={!kpis || !ordersOk}>
              <i className="bi bi-file-earmark-spreadsheet me-1" aria-hidden="true" />รายงานแผน (Excel)
            </Button>
          </>
        )}
      />
      {ordersError && (
        <div className="text-danger small mb-2">
          {ordersError} — ตัวเลขช้า/เฉียด/ของไม่เข้า และปุ่มรายงานแผนใช้ไม่ได้จนกว่าจะกดรีเฟรชสำเร็จ
        </div>
      )}
      <KpiStrip items={kpiItems} onSelect={(id) => setActiveTab(KPI_TAB[id])} />

      <Tabs activeKey={activeTab} onSelect={(k) => k && setActiveTab(k)} className="mb-2">
        <Tab eventKey="delivery" title="Delivery">
          <DeliveryTab reportData={reportData} previousReportData={prevReportData} today={today} asOf={asOf} />
        </Tab>
        <Tab eventKey="late" title="Late / At-risk">
          {orders === null
            ? <div className="text-center py-5"><Spinner animation="border" className="text-mse" /></div>
            : <LateRiskTab reportData={reportData} orders={orders} today={today} asOf={asOf} />}
        </Tab>
        <Tab eventKey="schedule" title="Schedule" mountOnEnter>
          <ScheduleTab planData={planData} filter={scheduleFilter} onFilterChange={setScheduleFilter} today={today} asOf={asOf} />
        </Tab>
        <Tab eventKey="dispatch" title="Dispatch List" mountOnEnter>
          <DispatchTab planData={planData} today={today} asOf={asOf} />
        </Tab>
        <Tab eventKey="load" title="Load" mountOnEnter>
          <LoadTab planData={planData} today={today} asOf={asOf} onOpenSchedule={openSchedule} />
        </Tab>
        <Tab eventKey="material" title="Material" mountOnEnter>
          {orders === null
            ? <div className="text-center py-5"><Spinner animation="border" className="text-mse" /></div>
            : <MaterialShortageTab orders={orders} today={today} asOf={asOf} />}
        </Tab>
      </Tabs>
    </Container>
  );
};

export default PlanningView;
