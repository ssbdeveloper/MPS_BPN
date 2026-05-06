import MachineHoursValidationPage from './MachineHoursValidationPage';

export default function MachineHoursSqlServerPage() {
  return (
    <MachineHoursValidationPage
      apiPrefix="/machine-hours-sqlserver"
      title="Machine Hours Validation"
      submittedStorageKey="machine_hours_sqlserver_submitted"
      filterStorageKey="machineHoursSqlServerShowFilters"
      postSapStorageKey="machineHoursSqlServerPostSap"
      emptyMessage="Tidak ada data machine hours SQL Server"
      detailLimit="all"
    />
  );
}
