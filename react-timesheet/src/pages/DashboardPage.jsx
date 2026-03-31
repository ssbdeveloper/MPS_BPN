import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Package, HardHat, Zap, Timer, TrendingUp, BarChart2, FileText, Download, Settings } from 'lucide-react';
import {
  PageContainer,
  AppHeader,
  Button,
  MachineCard
} from '../components';

/**
 * Dashboard Page
 * Halaman analytics dan reports
 */
const DashboardPage = () => {
  const navigate = useNavigate();

  // Demo data
  const statsCards = [
    {
      title: 'Total Production',
      value: '1,245',
      unit: 'units',
      trend: '+12%',
      trendUp: true,
      icon: Package,
      color: 'bg-blue-500'
    },
    {
      title: 'Active Workers',
      value: '48',
      unit: 'people',
      trend: '+3',
      trendUp: true,
      icon: HardHat,
      color: 'bg-green-500'
    },
    {
      title: 'Avg Efficiency',
      value: '87',
      unit: '%',
      trend: '+5%',
      trendUp: true,
      icon: Zap,
      color: 'bg-yellow-500'
    },
    {
      title: 'Downtime',
      value: '2.5',
      unit: 'hours',
      trend: '-15%',
      trendUp: false,
      icon: Timer,
      color: 'bg-red-500'
    }
  ];

  const machines = [
    {
      code: 'M001',
      name: 'CNC Machine 1',
      status: 'Active',
      efficiency: '92%',
      operator: 'John Doe'
    },
    {
      code: 'M002',
      name: 'Lathe Machine',
      status: 'Idle',
      efficiency: '75%',
      operator: 'Jane Smith'
    },
    {
      code: 'M003',
      name: 'Milling Machine',
      status: 'Active',
      efficiency: '88%',
      operator: 'Bob Wilson'
    }
  ];

  return (
    <PageContainer>
      <AppHeader
        title={<><BarChart2 className="inline w-5 h-5 mr-1.5" />Dashboard</>}
        rightContent={
          <Button variant="secondary" size="small" onClick={() => navigate('/')}>
            ← Back
          </Button>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat, index) => (
          <div
            key={index}
            className="bg-white rounded-xl p-5 shadow-md border border-gray-200 hover:shadow-lg transition-shadow duration-200"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`${stat.color} w-12 h-12 rounded-lg flex items-center justify-center`}>
                <stat.icon className="w-6 h-6 text-white" />
              </div>
              <div
                className={`px-2 py-1 rounded-full text-xs font-semibold ${
                  stat.trendUp
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}
              >
                {stat.trend}
              </div>
            </div>
            <h3 className="text-gray-600 text-sm font-medium mb-1">
              {stat.title}
            </h3>
            <div className="flex items-end gap-1">
              <span className="text-3xl font-bold text-gray-800">
                {stat.value}
              </span>
              <span className="text-gray-500 text-sm mb-1">{stat.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Production Chart Placeholder */}
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
          <h3 className="font-bold text-lg text-gray-800 mb-4">
            Production Trend
          </h3>
          <div className="h-64 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg flex items-center justify-center">
            <div className="text-center text-gray-500">
              <div className="flex justify-center mb-2"><TrendingUp className="w-10 h-10 text-gray-400" /></div>
              <p className="text-sm">Chart will be displayed here</p>
              <p className="text-xs mt-1">(Integration with Chart.js or Recharts)</p>
            </div>
          </div>
        </div>

        {/* Efficiency Chart Placeholder */}
        <div className="bg-white rounded-xl p-5 shadow-md border border-gray-200">
          <h3 className="font-bold text-lg text-gray-800 mb-4">
            Efficiency Rate
          </h3>
          <div className="h-64 bg-gradient-to-br from-green-50 to-green-100 rounded-lg flex items-center justify-center">
            <div className="text-center text-gray-500">
              <div className="flex justify-center mb-2"><BarChart2 className="w-10 h-10 text-gray-400" /></div>
              <p className="text-sm">Chart will be displayed here</p>
              <p className="text-xs mt-1">(Integration with Chart.js or Recharts)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Machine Status */}
      <div className="bg-white rounded-xl p-5 shadow-md">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-lg text-gray-800">Machine Status</h3>
          <Button variant="primary" size="small">
            View All
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {machines.map((machine, index) => (
            <MachineCard
              key={index}
              title={machine.code}
              details={[
                { label: 'Name', value: machine.name },
                { label: 'Status', value: machine.status },
                { label: 'Efficiency', value: machine.efficiency },
                { label: 'Operator', value: machine.operator }
              ]}
              onClick={() => console.log('Machine clicked:', machine)}
            />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Button variant="primary" className="h-20">
          <FileText className="inline w-4 h-4 mr-1" />Daily Report
        </Button>
        <Button variant="success" className="h-20">
          <BarChart2 className="inline w-4 h-4 mr-1" />Analytics
        </Button>
        <Button variant="warning" className="h-20">
          <Download className="inline w-4 h-4 mr-1" />Export Data
        </Button>
        <Button variant="secondary" className="h-20">
          <Settings className="inline w-4 h-4 mr-1" />Settings
        </Button>
      </div>
    </PageContainer>
  );
};

export default DashboardPage;
