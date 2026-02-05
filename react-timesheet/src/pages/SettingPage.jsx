import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PageContainer,
  AppHeader,
  Button,
  Switch,
  FormRow,
  Input,
  Select
} from '../components';

/**
 * Setting Page
 * Halaman untuk konfigurasi dan preferences
 */
const SettingPage = () => {
  const navigate = useNavigate();

  // States untuk settings
  const [autoCheckout, setAutoCheckout] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [offlineMode, setOfflineMode] = useState(true);

  const handleSave = () => {
    console.log('Settings saved:', {
      autoCheckout,
      notifications,
      darkMode,
      offlineMode
    });
    alert('Settings saved successfully!');
  };

  const handleReset = () => {
    setAutoCheckout(false);
    setNotifications(true);
    setDarkMode(false);
    setOfflineMode(true);
    alert('Settings reset to default!');
  };

  return (
    <PageContainer>
      <AppHeader
        title="⚙️ Settings"
        rightContent={
          <Button variant="secondary" size="small" onClick={() => navigate('/')}>
            ← Back
          </Button>
        }
      />

      {/* User Profile Section */}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
          👤 User Profile
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormRow label="Employee ID">
            <Input value="EMP-001" disabled className="bg-gray-100" />
          </FormRow>
          <FormRow label="Full Name">
            <Input value="John Doe" />
          </FormRow>
          <FormRow label="Email">
            <Input type="email" value="john.doe@company.com" />
          </FormRow>
          <FormRow label="Phone">
            <Input type="tel" value="+62 812-3456-7890" />
          </FormRow>
          <FormRow label="Department">
            <Select
              value="production"
              options={[
                { value: 'production', label: 'Production' },
                { value: 'quality', label: 'Quality Control' },
                { value: 'maintenance', label: 'Maintenance' },
                { value: 'admin', label: 'Administration' }
              ]}
            />
          </FormRow>
          <FormRow label="Shift">
            <Select
              value="shift1"
              options={[
                { value: 'shift1', label: 'Shift 1 (07:00 - 15:00)' },
                { value: 'shift2', label: 'Shift 2 (15:00 - 23:00)' },
                { value: 'shift3', label: 'Shift 3 (23:00 - 07:00)' }
              ]}
            />
          </FormRow>
        </div>
        <div className="mt-4 flex gap-3">
          <Button variant="primary">Update Profile</Button>
          <Button variant="secondary">Change Password</Button>
        </div>
      </div>

      {/* Application Settings */}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
          🔧 Application Settings
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Auto Check-out</h4>
              <p className="text-sm text-gray-600">
                Automatically check-out at end of shift
              </p>
            </div>
            <Switch
              checked={autoCheckout}
              onChange={setAutoCheckout}
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Notifications</h4>
              <p className="text-sm text-gray-600">
                Enable push notifications for updates
              </p>
            </div>
            <Switch
              checked={notifications}
              onChange={setNotifications}
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Dark Mode</h4>
              <p className="text-sm text-gray-600">
                Use dark theme for better night viewing
              </p>
            </div>
            <Switch
              checked={darkMode}
              onChange={setDarkMode}
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h4 className="font-semibold text-gray-800">Offline Mode</h4>
              <p className="text-sm text-gray-600">
                Cache data for offline access
              </p>
            </div>
            <Switch
              checked={offlineMode}
              onChange={setOfflineMode}
            />
          </div>
        </div>
      </div>

      {/* System Information */}
      <div className="bg-white rounded-xl p-6 shadow-md">
        <h3 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
          ℹ️ System Information
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">App Version</span>
            <span className="font-semibold text-gray-800">2.0.0</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Plant ID</span>
            <span className="font-semibold text-gray-800">5071</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Server Status</span>
            <span className="font-semibold text-green-600">🟢 Online</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Last Sync</span>
            <span className="font-semibold text-gray-800">2 mins ago</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Cache Size</span>
            <span className="font-semibold text-gray-800">24.5 MB</span>
          </div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg">
            <span className="text-gray-600">Database</span>
            <span className="font-semibold text-gray-800">PostgreSQL</span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" onClick={handleSave} className="flex-1 md:flex-none">
          💾 Save Settings
        </Button>
        <Button variant="warning" onClick={handleReset} className="flex-1 md:flex-none">
          🔄 Reset to Default
        </Button>
        <Button variant="danger" className="flex-1 md:flex-none">
          🗑️ Clear Cache
        </Button>
        <Button variant="secondary" className="flex-1 md:flex-none">
          📥 Export Settings
        </Button>
      </div>

      {/* About */}
      <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl p-6 border border-primary/20">
        <div className="text-center">
          <h4 className="font-bold text-lg text-gray-800 mb-2">
            MPS Timesheet System
          </h4>
          <p className="text-sm text-gray-600 mb-3">
            Manufacturing Production System - Version 2.0.0
          </p>
          <p className="text-xs text-gray-500">
            © 2026 MPS Manufacturing. All rights reserved.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button variant="primary" size="small">
              📖 Help
            </Button>
            <Button variant="secondary" size="small">
              📧 Support
            </Button>
            <Button variant="secondary" size="small">
              🔗 About
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
};

export default SettingPage;
