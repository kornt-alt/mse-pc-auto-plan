import React from 'react';
import { Tabs, Tab } from 'react-bootstrap';
import ByBatchTab from './ByBatchTab';
import ByMachineTab from './ByMachineTab';
import PageHeader from '../../components/shared/PageHeader';

// Plan & Actual — port จาก mes_dashboard_screen.dart (2 แท็บ)
const PlanActualPage = () => (
  <div className="container-fluid py-3">
    <PageHeader
      icon="bi-bar-chart-line"
      title="Plan &amp; Actual"
      subtitle="เทียบแผนกับยอดผลิตจริง รายแบตช์และรายเครื่องจักร"
    />
    <Tabs defaultActiveKey="batch" className="mb-3">
      <Tab eventKey="batch" title="By Batch">
        <ByBatchTab />
      </Tab>
      <Tab eventKey="machine" title="By Machine">
        <ByMachineTab />
      </Tab>
    </Tabs>
  </div>
);

export default PlanActualPage;
