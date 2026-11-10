import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export type Role = 'passenger' | 'driver';
export type Restriction = 'none' | 'admin_approval' | 'blocked';
export type DriverStatus = 'pending' | 'approved' | 'rejected' | 'photos_requested' | 'suspended';
export type PrivilegeKind = 'verified_badge' | 'priority';
export type Side = 'a' | 'b';
export type LocalityKind = 'city' | 'village';
export type PickupMode = 'door' | 'points' | 'mixed';
export type Trunk = 'free' | 'half' | 'full';
export type TripStatus = 'published' | 'departed' | 'completed' | 'cancelled';
export type PassengerType = 'adult' | 'teen' | 'child';
export type ChildSeat = 'none' | 'own' | 'driver';
export type Baggage = 'bag' | 'suitcase' | 'many';
export type BookingSource = 'bot' | 'phone' | 'request';
export type BookingStatus =
  | 'pending_admin' // ждёт подтверждения админа (пассажир с ограничением)
  | 'pending' // ждёт ответа водителя
  | 'accepted' // водитель принял
  | 'confirmed' // пассажир ответил «Да, еду»
  | 'picked_up' // в машине
  | 'completed'
  | 'declined' // водитель или админ отказал
  | 'cancelled'
  | 'no_show';
export type CancelledBy = 'passenger' | 'driver' | 'admin';
export type TimeKind = 'morning' | 'day' | 'evening' | 'exact';
export type RequestStatus = 'open' | 'taken' | 'closed' | 'cancelled' | 'expired';
export type ComplaintKind = 'complaint' | 'wrong_person';
export type ComplaintStatus = 'new' | 'in_progress' | 'resolved';

/** Все пользователи бота. Имя вводится вручную, телефон — только кнопкой «Поделиться номером». */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: text('username'),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  activeRole: text('active_role').$type<Role>().notNull().default('passenger'),
  restriction: text('restriction').$type<Restriction>().notNull().default('none'),
  restrictionReason: text('restriction_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Анкета водителя. Без статуса approved рейсы не публикуются. */
export const drivers = pgTable('drivers', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id),
  fullName: text('full_name').notNull(),
  car: text('car').notNull(),
  carYear: integer('car_year').notNull(),
  carColor: text('car_color').notNull(),
  plate: text('plate').notNull(),
  seats: integer('seats').notNull(),
  childSeat: boolean('child_seat').notNull().default(false),
  carPhotos: jsonb('car_photos').$type<string[]>().notNull().default([]),
  payPhone: text('pay_phone').notNull(),
  payBank: text('pay_bank').notNull(),
  status: text('status').$type<DriverStatus>().notNull().default('pending'),
  rejectReason: text('reject_reason'),
  reviewedBy: integer('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Ручные привилегии водителя: значок «Проверен», приоритет в поиске. */
export const privileges = pgTable(
  'privileges',
  {
    id: serial('id').primaryKey(),
    driverId: integer('driver_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind').$type<PrivilegeKind>().notNull(),
    until: ts('until'),
    grantedBy: integer('granted_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('privileges_driver_kind').on(t.driverId, t.kind)],
);

/** Направление: город A ⇄ город B. Новые города добавляются строкой, а не кодом. */
export const directions = pgTable('directions', {
  id: serial('id').primaryKey(),
  cityA: text('city_a').notNull(),
  cityB: text('city_b').notNull(),
  travelMinutes: integer('travel_minutes').notNull().default(120),
  channelId: text('channel_id'),
  active: boolean('active').notNull().default(true),
});

/** Города и деревни направления. side — к какому концу направления относится. */
export const localities = pgTable(
  'localities',
  {
    id: serial('id').primaryKey(),
    directionId: integer('direction_id')
      .notNull()
      .references(() => directions.id),
    name: text('name').notNull(),
    kind: text('kind').$type<LocalityKind>().notNull(),
    side: text('side').$type<Side>().notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('localities_direction').on(t.directionId)],
);

export const driverDirections = pgTable(
  'driver_directions',
  {
    driverId: integer('driver_id')
      .notNull()
      .references(() => users.id),
    directionId: integer('direction_id')
      .notNull()
      .references(() => directions.id),
  },
  (t) => [primaryKey({ columns: [t.driverId, t.directionId] })],
);

/** Рейс водителя. fromSide = 'a' значит «из города A в город B». */
export const trips = pgTable(
  'trips',
  {
    id: serial('id').primaryKey(),
    driverId: integer('driver_id')
      .notNull()
      .references(() => users.id),
    directionId: integer('direction_id')
      .notNull()
      .references(() => directions.id),
    fromSide: text('from_side').$type<Side>().notNull(),
    departsAt: ts('departs_at').notNull(),
    pickupMode: text('pickup_mode').$type<PickupMode>().notNull(),
    pickupPoints: jsonb('pickup_points').$type<string[]>().notNull().default([]),
    villages: boolean('villages').notNull().default(false),
    villagesNote: text('villages_note'),
    seatsTotal: integer('seats_total').notNull(),
    seatsFree: integer('seats_free').notNull(),
    trunk: text('trunk').$type<Trunk>().notNull(),
    price: integer('price').notNull(),
    status: text('status').$type<TripStatus>().notNull().default('published'),
    createdAt: ts('created_at').notNull().defaultNow(),
    departedAt: ts('departed_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [
    index('trips_search').on(t.directionId, t.fromSide, t.departsAt),
    index('trips_driver').on(t.driverId, t.departsAt),
  ],
);

/** Бронь. Заказчик (bookedBy) и пассажир — разные люди, если поездку оформили за другого. */
export const bookings = pgTable(
  'bookings',
  {
    id: serial('id').primaryKey(),
    tripId: integer('trip_id')
      .notNull()
      .references(() => trips.id),
    bookedBy: integer('booked_by').references(() => users.id),
    passengerUserId: integer('passenger_user_id').references(() => users.id),
    passengerName: text('passenger_name'),
    passengerPhone: text('passenger_phone'),
    passengerType: text('passenger_type').$type<PassengerType>().notNull().default('adult'),
    source: text('source').$type<BookingSource>().notNull().default('bot'),
    requestId: integer('request_id'),
    fromLocalityId: integer('from_locality_id').references(() => localities.id),
    fromAddress: text('from_address'),
    fromLat: doublePrecision('from_lat'),
    fromLon: doublePrecision('from_lon'),
    toLocalityId: integer('to_locality_id').references(() => localities.id),
    toAddress: text('to_address'),
    toLat: doublePrecision('to_lat'),
    toLon: doublePrecision('to_lon'),
    pickupPoint: text('pickup_point'),
    seats: integer('seats').notNull(),
    childSeat: text('child_seat').$type<ChildSeat>().notNull().default('none'),
    baggage: text('baggage').$type<Baggage>().notNull().default('bag'),
    baggageNote: text('baggage_note'),
    comment: text('comment'),
    price: integer('price').notNull().default(0),
    prepayRequired: boolean('prepay_required').notNull().default(false),
    prepayReceivedAt: ts('prepay_received_at'),
    status: text('status').$type<BookingStatus>().notNull().default('pending'),
    cancelledBy: text('cancelled_by').$type<CancelledBy>(),
    lateCancel: boolean('late_cancel').notNull().default(false),
    pickupOrder: integer('pickup_order').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    acceptedAt: ts('accepted_at'),
    askSentAt: ts('ask_sent_at'),
    confirmedAt: ts('confirmed_at'),
    noAnswerNotifiedAt: ts('no_answer_notified_at'),
    prepayWarnedAt: ts('prepay_warned_at'),
    pickedUpAt: ts('picked_up_at'),
    completedAt: ts('completed_at'),
    cancelledAt: ts('cancelled_at'),
  },
  (t) => [index('bookings_trip').on(t.tripId), index('bookings_booked_by').on(t.bookedBy)],
);

export const savedAddresses = pgTable(
  'saved_addresses',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    label: text('label').notNull(),
    localityId: integer('locality_id')
      .notNull()
      .references(() => localities.id),
    address: text('address').notNull(),
    lat: doublePrecision('lat'),
    lon: doublePrecision('lon'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('saved_addresses_user').on(t.userId)],
);

export const savedPassengers = pgTable(
  'saved_passengers',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    type: text('type').$type<PassengerType>().notNull().default('adult'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('saved_passengers_user').on(t.userId)],
);

/** Заявка пассажира, когда подходящего рейса нет. */
export const requests = pgTable(
  'requests',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    directionId: integer('direction_id')
      .notNull()
      .references(() => directions.id),
    fromSide: text('from_side').$type<Side>().notNull(),
    day: text('day').notNull(), // YYYY-MM-DD в часовом поясе приложения
    timeKind: text('time_kind').$type<TimeKind>().notNull(),
    exactMinutes: integer('exact_minutes'),
    windowFrom: ts('window_from').notNull(),
    windowTo: ts('window_to').notNull(),
    passengerName: text('passenger_name').notNull(),
    passengerPhone: text('passenger_phone').notNull(),
    passengerType: text('passenger_type').$type<PassengerType>().notNull().default('adult'),
    fromLocalityId: integer('from_locality_id')
      .notNull()
      .references(() => localities.id),
    fromAddress: text('from_address').notNull(),
    fromLat: doublePrecision('from_lat'),
    fromLon: doublePrecision('from_lon'),
    toLocalityId: integer('to_locality_id')
      .notNull()
      .references(() => localities.id),
    toAddress: text('to_address').notNull(),
    toLat: doublePrecision('to_lat'),
    toLon: doublePrecision('to_lon'),
    seats: integer('seats').notNull(),
    childSeat: text('child_seat').$type<ChildSeat>().notNull().default('none'),
    baggage: text('baggage').$type<Baggage>().notNull().default('bag'),
    baggageNote: text('baggage_note'),
    comment: text('comment'),
    status: text('status').$type<RequestStatus>().notNull().default('open'),
    takenBy: integer('taken_by').references(() => users.id),
    bookingId: integer('booking_id'),
    escalatedAt: ts('escalated_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
  },
  (t) => [index('requests_open').on(t.status, t.directionId)],
);

export const complaints = pgTable(
  'complaints',
  {
    id: serial('id').primaryKey(),
    fromUserId: integer('from_user_id')
      .notNull()
      .references(() => users.id),
    againstUserId: integer('against_user_id').references(() => users.id),
    bookingId: integer('booking_id').references(() => bookings.id),
    kind: text('kind').$type<ComplaintKind>().notNull().default('complaint'),
    text: text('text').notNull(),
    status: text('status').$type<ComplaintStatus>().notNull().default('new'),
    note: text('note'),
    resolution: text('resolution'),
    handledBy: integer('handled_by').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [index('complaints_status').on(t.status)],
);

/** Сводный пост «Рейсы на <день>» в канале направления. */
export const channelPosts = pgTable(
  'channel_posts',
  {
    id: serial('id').primaryKey(),
    directionId: integer('direction_id')
      .notNull()
      .references(() => directions.id),
    day: text('day').notNull(),
    messageId: integer('message_id').notNull(),
    lastText: text('last_text').notNull().default(''),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('channel_posts_direction_day').on(t.directionId, t.day)],
);

/** Числа-правила: лимиты и сроки. Меняются админом без правки кода. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Незаконченные пошаговые сценарии пользователей (плагин conversations). */
export const conversationStates = pgTable('conversation_states', {
  key: text('key').primaryKey(),
  data: jsonb('data').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type DriverRow = typeof drivers.$inferSelect;
export type DirectionRow = typeof directions.$inferSelect;
export type LocalityRow = typeof localities.$inferSelect;
export type TripRow = typeof trips.$inferSelect;
export type BookingRow = typeof bookings.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export type ComplaintRow = typeof complaints.$inferSelect;
export type SavedAddressRow = typeof savedAddresses.$inferSelect;
export type SavedPassengerRow = typeof savedPassengers.$inferSelect;
