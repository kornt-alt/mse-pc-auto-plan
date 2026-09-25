import React, { useState } from 'react';
import { Tabs, Tab } from 'react-bootstrap';
import ByBatchTab from './ByBatchTab';
import ByMachineTab from './ByMachineTab';
import MachineSummaryTab from './MachineSummaryTab';
import PageHeader from '../../components/shared/PageHeader';
import { todayBangkok } from '../../utils/dates';

// Plan & Actual — เดิม port จาก mes_dashboard_screen.dart (2 แท็บ) · ปรับใหม่ 2026-09-25:
// เพิ่มแท็บ "สรุปรายเครื่อง" เป็นหน้าแรก (เห็นภาพรวมทันทีไม่ต้องเลือกอะไร) กดชื่อเครื่องแล้วไป By Machine
const PlanActualPage = () => {
  const today = todayBangkok();
  const [activeTab, setActiveTab] = useState('summary');
  const [machine, setMachine] = useState(null);

  const openMachine = (m) => {
    setMachine(m);
    setActiveTab('machine');
  };

  return (
    <div className="container-fluid py-3">
      <PageHeader
        icon="bi-bar-chart-line"
        title="Plan &amp; Actual"
        subtitle="เทียบแผนกับยอดผลิตจริง ทั้งภาพรวมรายเครื่อง รายเครื่อง และรายแบตช์"
      />
      <Tabs activeKey={activeTab} onSelect={(k) => k && setActiveTab(k)} className="mb-3">
        <Tab eventKey="summary" title="สรุปรายเครื่อง">
          <MachineSummaryTab today={today} onOpenMachine={openMachine} />
        </Tab>
        <Tab eventKey="machine" title="By Machine" mountOnEnter>
          <ByMachineTab today={today} machine={machine} onMachineChange={setMachine} />
        </Tab>
        <Tab eventKey="batch" title="By Batch" mountOnEnter>
          <ByBatchTab today={today} />
        </Tab>
      </Tabs>
    </div>
  );
};

export default PlanActualPage;
