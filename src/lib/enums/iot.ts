export enum DeviceType {
    DOOR_SENSOR = 'door_sensor',
    CAMERA = 'camera',
    SENSOR = 'sensor',
    ACTUATOR = 'actuator',
    CONTROLLER = 'controller',
    GATEWAY = 'gateway',
    RFID = 'rfid',
    NFC = 'nfc',
    BARCODE = 'barcode',
    BEACON = 'beacon',
    OTHER = 'other'
}

export enum DeviceStatus {
    ONLINE = 'online',
    OFFLINE = 'offline',
    MAINTENANCE = 'maintenance',
    DISCONNECTED = 'disconnected'
}