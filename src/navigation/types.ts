export type RootStackParamList = {
  MainTabs: undefined;
  ClientDetail: { clientId: string };
  ProductDetail: { productId: string };
  AppointmentDetail: { appointmentId: string };
  NewAppointment: { clientId?: string; prefillService?: string; date?: string };
  Settings: undefined;
  Reports: undefined;
  ScanModal: undefined;
  StockTake: undefined;
  ClientForm: { clientId?: string };
  ProductForm: { productId?: string };
  ServiceForm: { serviceId?: string };
  RescheduleModal: { appointmentId: string };
  AppointmentEdit: { appointmentId: string };
};

export type TabParamList = {
  Today: undefined;
  Clients: undefined;
  Calendar: undefined;
  Inventory: undefined;
};
