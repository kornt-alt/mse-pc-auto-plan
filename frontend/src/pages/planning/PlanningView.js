// Planning View — 3 แท็บชื่อเดิมเป๊ะ (typo ด้วย): "Planing Chart" / "Shipment Date" /
// "Planing Table" (dashboard_screen.dart) — filter state แยกต่อแท็บ (อยู่ในแต่ละ tab
// component เอง และคงอยู่เพราะ Tabs ไม่ unmount แท็บที่ไม่ active)
import React, { useEffect } from 'react';
import { Container, Tabs, Tab, Spinner } from 'react-bootstrap';
import { usePlanData } from '../../context/PlanDataContext';
import OverviewTab from './OverviewTab';
import ReportTab from './ReportTab';
import DetailedTab from './DetailedTab';
import PageHeader from '../../components/shared/PageHeader';
import './planning.css';

const PlanningView = () => {
  const { planData, reportData, prevReportData, loading, loadLatest } = usePlanData();

  // กู้คืนข้อมูลหลัง refresh — เรียกเฉพาะตอนยังไม่มีข้อมูล (dashboard_screen.dart L70-72)
  useEffect(() => {
    if (planData === null) loadLatest();
  }, [planData, loadLatest]);

  if (loading || planData === null) {
    return (
      <Container fluid className="text-center py-5">
        <Spinner animation="border" className="text-mse" />
      </Container>
    );
  }

  return (
    <Container fluid className="px-3">
      <PageHeader
        icon="bi-grid-3x3"
        title="Planning View"
        subtitle="แผนการผลิตรายเครื่องจักร และกำหนดส่งของแต่ละแบตช์"
      />
      <Tabs defaultActiveKey="chart" className="mb-2">
        <Tab eventKey="chart" title="Planing Chart">
          <OverviewTab planData={planData} />
        </Tab>
        <Tab eventKey="shipment" title="Shipment Date">
          <ReportTab reportData={reportData} previousReportData={prevReportData} />
        </Tab>
        <Tab eventKey="table" title="Planing Table">
          <DetailedTab planData={planData} />
        </Tab>
      </Tabs>
    </Container>
  );
};

export default PlanningView;
