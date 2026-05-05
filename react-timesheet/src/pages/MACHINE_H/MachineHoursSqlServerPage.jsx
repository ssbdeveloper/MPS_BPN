import MachineHoursValidationPage from './MachineHoursValidationPage';

export default function MachineHoursSqlServerPage() {
  return (
    <MachineHoursValidationPage
      apiPrefix="/machine-hours-sqlserver"
      title="Machine Hours SQL Server"
      submittedStorageKey="machine_hours_sqlserver_submitted"
      filterStorageKey="machineHoursSqlServerShowFilters"
      postSapStorageKey="machineHoursSqlServerPostSap"
      emptyMessage="Tidak ada data machine hours SQL Server"
    />
  );
}
