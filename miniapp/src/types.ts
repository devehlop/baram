// Формы данных, которые отдаёт API (src/api/server.ts). Даты — строки ISO.

export type Side = 'a' | 'b';
export type TimeKind = 'morning' | 'day' | 'evening' | 'exact';
export type ChildSeat = 'none' | 'own' | 'driver';
export type Baggage = 'bag' | 'suitcase' | 'many';
export type PassengerType = 'adult' | 'teen' | 'child';
export type PickupMode = 'door' | 'points' | 'mixed';
export type Trunk = 'free' | 'half' | 'full';
export type BookingStatus =
  | 'pending_admin'
  | 'pending'
  | 'accepted'
  | 'confirmed'
  | 'picked_up'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'no_show';

export interface Locality {
  id: number;
  directionId: number;
  name: string;
  kind: 'city' | 'village';
  side: Side;
}

export interface SavedAddress {
  id: number;
  label: string;
  localityId: number;
  city: string;
  village: boolean;
  directionId: number;
  side: Side;
  address: string;
}

export interface SavedPassenger {
  id: number;
  name: string;
  phone: string;
  type: PassengerType;
}

export interface DayOption {
  day: string;
  label: string;
}

export interface Trip {
  id: number;
  directionId: number;
  fromSide: Side;
  route: string;
  fromCity: string;
  toCity: string;
  travelMinutes: number;
  departsAt: string;
  pickupMode: PickupMode;
  pickupPoints: string[];
  villages: boolean;
  villagesNote: string | null;
  seatsTotal: number;
  seatsFree: number;
  trunk: Trunk;
  price: number;
  status: 'published' | 'departed' | 'completed' | 'cancelled';
  driver: {
    name: string;
    car: string;
    carYear: number;
    carColor: string;
    childSeat: boolean;
    badge: boolean;
    priority: boolean;
    photo: string | null;
    // Открываются после подтверждения брони:
    plate?: string;
    phone?: string;
    payPhone?: string;
    payBank?: string;
    fullName?: string;
  };
}

export interface Place {
  localityId: number;
  city: string;
  village: boolean;
  address: string;
  lat: number | null;
  lon: number | null;
}

export interface Booking {
  id: number;
  tripId: number;
  status: BookingStatus;
  source: 'bot' | 'phone' | 'request';
  seats: number;
  price: number;
  childSeat: ChildSeat;
  baggage: Baggage;
  baggageNote: string | null;
  comment: string | null;
  pickupPoint: string | null;
  prepayRequired: boolean;
  prepayReceived: boolean;
  lateCancel: boolean;
  passengerName: string | null;
  passengerPhone: string | null;
  passengerType: PassengerType;
  booker: { id: number; name: string; phone: string } | null;
  isSelf: boolean;
  from: Place | null;
  to: Place | null;
}

export interface RideRequest {
  id: number;
  route: string;
  day: string;
  timeKind: TimeKind;
  exactMinutes: number | null;
  seats: number;
}

export interface Me {
  registered: boolean;
  botUsername: string | null;
  dispatcherPhone: string | null;
  user?: { id: number; name: string; phone: string; activeRole: 'passenger' | 'driver' };
  driver?: { status: string; car: string; plate: string; seats: number; badge: boolean } | null;
  isAdmin?: boolean;
  prepay?: number;
  lateCancelHours?: number;
}

export interface FormData {
  localities: Locality[];
  addresses: SavedAddress[];
  passengers: SavedPassenger[];
  days: DayOption[];
  lastBooking: Booking | null;
}

export interface DriverHome {
  driver: { name: string; status: string; badge: boolean; seats: number; rejectReason: string | null };
  trips: Trip[];
  pending: { booking: Booking; trip: Trip }[];
  openRequests: number;
  last: Trip | null;
  routes: { directionId: number; fromSide: Side; label: string }[];
  days: DayOption[];
  priceMin: number;
  priceMax: number;
}
