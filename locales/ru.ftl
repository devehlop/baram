### Барам — все тексты бота на русском.
### Правило: в коде текста нет, только ключи. Чтобы добавить татарский — скопировать файл в tt.ftl и перевести.
### Синтаксис: Project Fluent. { $name } — подстановка, <b>…</b> — жирный текст в Telegram.

## Общие кнопки

btn-back = ‹ Назад
btn-home = В начало
btn-yes = Да
btn-no = Нет
btn-fix = Исправить
btn-all-correct = ✅ Всё верно
btn-skip = Пропустить
btn-cancel = Отмена
btn-close = Закрыть
btn-open = Открыть
btn-navigator = 🧭 Навигатор
btn-complain = Пожаловаться
btn-photos-done = Готово
btn-send-for-review = ✅ Отправить на проверку
btn-approve = ✅ Одобрить
btn-reject = Отклонить
btn-request-photos = Запросить фото заново
btn-refresh = Обновить

## Общие сообщения

stale-button = Эта кнопка уже не работает. Откройте меню внизу экрана.
hint-use-buttons = Пожалуйста, нажмите одну из кнопок выше.
hint-text-length = Напишите от { $min } до { $max } символов.
error-generic = Что-то пошло не так. Попробуйте ещё раз или нажмите /start.
fallback = Я не понял сообщение. Выберите, что нужно, кнопкой внизу.
blocked-message = Ваш аккаунт заблокирован. Если это ошибка, свяжитесь с диспетчером.
your-id = Ваш Telegram ID: <code>{ $id }</code>
ask-what-to-fix = Что исправить?
done = Готово.
not-found = Не найдено. Возможно, это уже неактуально.
only-drivers = Это доступно водителям. Заполните анкету водителя.
only-admins = Это доступно только администратору.

## Главное меню

menu-title-passenger = Что нужно сделать?
menu-title-driver = Меню водителя. Что нужно сделать?
menu-find = 🚗 Найти поездку
menu-my-trips = 🔁 Мои поездки
menu-help = ☎️ Помощь
menu-become-driver = 🚘 Я водитель
menu-to-driver = 🚘 Меню водителя
menu-post-trip = ➕ Выложить рейс
menu-driver-trips = 📋 Мои рейсы
menu-requests = 🔔 Заявки
menu-driver-data = 👤 Мои данные
menu-to-passenger = 🧍 Я пассажир
menu-admin = 🛠 Админ

## Регистрация

reg-welcome =
    Здравствуйте! Это «Барам» — попутчики Буинск ⇄ Казань.

    Вы едете как пассажир или вы водитель?
reg-role-passenger = Я пассажир
reg-role-driver = Я водитель
reg-ask-name = Как вас зовут? Напишите имя.
reg-name-hint = Напишите, пожалуйста, имя буквами. Например: Айгуль.
reg-ask-phone =
    Приятно познакомиться, { $name }!

    Нужен ваш номер телефона, чтобы водитель и пассажир могли созвониться. Нажмите кнопку «Поделиться номером» внизу экрана.
reg-share-phone = 📱 Поделиться номером
reg-phone-hint = Номер принимается только кнопкой «Поделиться номером» — она внизу экрана.
reg-done-passenger = Готово, { $name }! Чтобы найти машину, нажмите «Найти поездку».
reg-done-driver = Спасибо, { $name }! Теперь анкета водителя — 10 коротких вопросов. Админ проверит её, и вы сможете выкладывать рейсы.

## Анкета водителя

drv-ask-fullname = Напишите фамилию, имя и отчество — как в водительских правах.
drv-fullname-hint = Напишите фамилию и имя буквами. Например: Галиев Ильдар Ринатович.
drv-ask-car = Какая у вас машина? Выберите или напишите марку и модель.
drv-ask-year = В каком году выпущена машина? Напишите год, например 2019.
drv-year-hint = Напишите год четырьмя цифрами, например 2019.
drv-ask-color = Какого цвета машина? Выберите или напишите.
color-white = Белый
color-black = Чёрный
color-gray = Серый
color-silver = Серебристый
color-blue = Синий
color-red = Красный
drv-ask-plate = Напишите госномер машины. Например: А123ВС116.
drv-plate-hint = Не получилось разобрать номер. Напишите его как на табличке, например: А123ВС116.
drv-ask-seats = Сколько пассажиров помещается в машину?
drv-ask-child-seat = Есть ли у вас детское кресло?
drv-ask-photos =
    Пришлите 2–4 фото машины: спереди с номером, сбоку, салон.

    Отправляйте по одному фото.
drv-photos-next = Фото { $n } принято. Пришлите ещё одно.
drv-photos-more = Фото { $n } из { $max } принято. Пришлите ещё или нажмите «Готово».
drv-photos-hint = Пришлите фото машины — обычным фото, не файлом.
drv-ask-pay-phone = На какой номер пассажиры переводят предоплату за крупный багаж (СБП)?
drv-pay-same = Тот же: { $phone }
drv-pay-phone-hint = Напишите номер телефона, например +7 917 123-45-67.
drv-ask-bank = В каком банке этот номер? Выберите или напишите.
drv-summary =
    <b>Проверьте анкету</b>

    ФИО: { $fullName }
    Машина: { $car }, { $year }, { $color }
    Госномер: { $plate }
    Мест для пассажиров: { $seats }
    Детское кресло: { $childSeat }
    Фото машины: { $photos }
    Предоплата: { $payPhone }, { $payBank }
drv-field-fullName = ФИО
drv-field-car = Машина
drv-field-year = Год
drv-field-color = Цвет
drv-field-plate = Госномер
drv-field-seats = Места
drv-field-childSeat = Кресло
drv-field-photos = Фото
drv-field-payPhone = Номер СБП
drv-field-payBank = Банк
drv-form-sent = Анкета отправлена на проверку. Мы напишем, как только админ её посмотрит. Обычно это быстро.
drv-form-cancelled = Анкета не отправлена. Вернуться к ней можно кнопкой «Я водитель».
drv-photos-sent = Фото отправлены на проверку.

## Карточки: общие подписи

label-from = Откуда
label-to = Куда
label-status = Статус
label-reason = Причина
label-driver = Водитель
label-baggage = Багаж
label-pickup-point = Точка сбора
label-in-bot = В боте
label-privileges = Отметки
place-unknown = адрес не указан
village-mark = деревня, доплата по договорённости
badge-verified = ✅ Проверен
priv-priority = приоритет в поиске
passenger-unknown = Пассажир
seats-count = { $n ->
    [one] { $n } место
    [few] { $n } места
   *[many] { $n } мест
}
time-morning = утром
time-day = днём
time-evening = вечером
time-exact = точное время
time-at = в { $time }
ptype-adult = взрослый
ptype-teen = подросток 14–17
ptype-child = ребёнок до 14
booking-rides = Едет
booking-booked-by = Оформил
mark-new-passenger = Новый пассажир
mark-reliable-passenger = Надёжный пассажир
mark-alone-teen = Подросток едет один
mark-alone-child = Ребёнок едет один
baggage-bag = только сумка или рюкзак
baggage-suitcase = чемодан или большая сумка
baggage-many = много багажа
child-seat-own = Ребёнок до 7 лет, кресло своё
child-seat-driver = Ребёнок до 7 лет, нужно кресло водителя
prepay-received = Предоплата за багаж получена
prepay-waiting = Ждём предоплату за багаж
phone-booking-title = По телефону · { $n ->
    [one] { $n } место
    [few] { $n } места
   *[many] { $n } мест
}
phone-booking-no-data = Без данных пассажира
booking-late-cancel-mark = Поздняя отмена
booking-status-pending_admin = ждёт подтверждения админа
booking-status-pending = ждёт ответа водителя
booking-status-accepted = водитель подтвердил
booking-status-confirmed = вы подтвердили поездку
booking-status-picked_up = в пути
booking-status-completed = завершена
booking-status-declined = водитель отказал
booking-status-cancelled = отменена
booking-status-no_show = пассажир не пришёл

## Карточка рейса

trip-seats = Свободно мест: { $free } из { $total }
trunk-free = Багажник свободен
trunk-half = Багажник занят наполовину
trunk-full = Багажник почти занят
trip-pickup-door = Забирает от дома и довозит до дома
trip-pickup-points = Забирает из своих точек: { $points }
trip-pickup-mixed = Смешанно: часть пути от дома, часть — из точек: { $points }
trip-villages-yes = Заезжает в деревни, доплата по договорённости
trip-villages-no = В деревни не заезжает
trip-child-seat-yes = Есть детское кресло
trip-child-seat-no = Нет детского кресла
trip-price = { $price } за место
trip-status-cancelled = Рейс отменён
trip-status-departed = Водитель в пути
trip-status-completed = Рейс завершён

## Анкета водителя: карточка и статусы

driver-seats = Мест для пассажиров: { $n }
driver-child-seat-yes = Есть детское кресло
driver-child-seat-no = Детского кресла нет
driver-pay = Предоплата: { $phone }, { $bank }
driver-status-pending = на проверке
driver-status-approved = проверен, можно выкладывать рейсы
driver-status-rejected = анкета отклонена
driver-status-photos_requested = нужны новые фото
driver-status-suspended = приостановлен админом

## Предоплата за крупный багаж

prepay-block =
    <b>Предоплата за крупный багаж — { $amount }</b>
    Переведите по СБП на номер { $phone } ({ $bank }), получатель — { $receiver }.

    ⚠️ Переводите только на номер из этой карточки. Водитель и админ никогда не просят перевести на другой номер. Если вас просят об этом — нажмите «Пожаловаться».

## Жалобы

complaint-kind-complaint = Жалоба
complaint-kind-wrong_person = Сел другой человек
complaint-status-new = новая
complaint-status-in_progress = в работе
complaint-status-resolved = решена
complaint-from = От кого
complaint-against = На кого
complaint-booking = Бронь

## Админ

adm-new-driver = <b>Новая анкета водителя</b>
adm-menu-title = <b>Админ</b>. Сверху — то, что ждёт вашего решения.
adm-menu-back = ‹ В меню админа
adm-none = нет
adm-drivers = Проверка водителей
adm-drivers-n = Ждут проверки: { $n }
adm-drivers-title = Анкеты водителей на проверке. Откройте анкету, чтобы посмотреть фото и данные.
adm-drivers-empty = Анкет на проверке нет.
adm-driver-approved = Водитель одобрен. Он получил сообщение и может выкладывать рейсы.
adm-driver-rejected = Анкета отклонена, водитель получил причину.
adm-driver-photos-requested = Водителю отправлена просьба прислать фото заново.
adm-driver-suspended = Водитель приостановлен.
adm-driver-suspend = Приостановить водителя
adm-driver-restore = Вернуть водителя в работу
adm-driver-form = Анкета водителя
adm-reject-ask = Почему отклоняете анкету? Выберите причину или напишите свою — водитель её увидит.
reject-reason-mismatch = Данные не совпадают
reject-reason-photo = Нечитаемое фото
reject-reason-other-car = Машина на фото не та
adm-reason-ask = Напишите причину. Её увидит человек, которого это касается.
adm-requests = Заявки без водителя
adm-requests-n = Заявки без водителя: { $n }
adm-requests-title = Заявки, которые никто не взял. Ближайшие по времени — сверху.
adm-requests-empty = Заявок без водителя нет.
adm-request-escalated = <b>Заявку никто не взял</b>
adm-request-candidates = Кому предложить:
adm-offer-to = Предложить:
adm-has-trip = есть рейс
adm-request-offered = Заявка отправлена водителю лично.
adm-request-close = Закрыть: водителя нет
adm-request-closed = Заявка закрыта, пассажир получил сообщение.
adm-complaints = Жалобы
adm-complaints-n = Открытые жалобы: { $n }
adm-complaints-title = Открытые жалобы. Срочные — сверху.
adm-complaints-empty = Открытых жалоб нет.
adm-complaint-take = Взять в работу
adm-complaint-note = Добавить заметку
adm-complaint-resolve = Решить и закрыть
adm-complaint-resolved = Жалоба закрыта.
adm-note-ask = Напишите заметку по жалобе. Её видят только админы.
adm-note-saved = Заметка сохранена.
adm-resolve-ask = Чем закончилось? Напишите решение — оно останется в истории.
adm-bookings = Брони на подтверждение
adm-bookings-n = Брони на подтверждение: { $n }
adm-bookings-title = <b>Брони пассажиров с ограничением</b>
adm-bookings-empty = Броней на подтверждение нет.
adm-booking-needs-approval = <b>Бронь ждёт вашего подтверждения</b>: у пассажира ограничение из-за поздних отмен или неявок.
adm-booking-allowed = Бронь разрешена и отправлена водителю.
adm-booking-rejected = Бронь отклонена, пассажир получил сообщение.
btn-allow = ✅ Разрешить
adm-users = Найти пользователя
adm-find-ask = Напишите телефон, имя или Telegram ID человека.
adm-find-results = Нашлись:
adm-find-none = Никого не нашлось.
adm-user-stats = Поездок: { $completed } · неявок: { $noShows } · поздних отмен: { $lateCancels }
adm-user-restriction = Ограничение
restriction-none = нет
restriction-admin_approval = бронь только с подтверждением админа
restriction-blocked = заблокирован
restriction-by-admin = решение админа
adm-user-limit = Бронь только через админа
adm-user-block = Заблокировать
adm-user-blocked = Пользователь заблокирован.
adm-user-free = Снять ограничения
adm-badge-grant = Выдать значок «Проверен»
adm-badge-revoke = Снять значок «Проверен»
adm-priority-grant = Выдать приоритет в поиске
adm-priority-revoke = Снять приоритет в поиске
adm-privilege-term = На какой срок выдать?
adm-term-30 = На 30 дней
adm-term-forever = Бессрочно
adm-settings = Настройки
adm-settings-title = <b>Настройки</b>. Нажмите на строку, чтобы изменить значение.
adm-setting-ask = { $name }. Напишите новое значение.
adm-setting-saved = Сохранено. { $name }: { $value }
adm-number-hint = Напишите целое число, например 30.
adm-channel-of = Канал { $route }
adm-travel-of = Время в пути { $route }, мин
adm-channel-ask =
    Напишите адрес канала, например @baram_buinsk.

    Бот должен быть администратором канала с правом публиковать сообщения.
adm-channel-hint = Напишите адрес канала в виде @название или его числовой ID (начинается с -100).
adm-channel-off = Отключить канал
adm-channel-saved = Канал сохранён. Сводный пост появится после первого рейса.
adm-channel-disabled = Публикация в канал отключена.
adm-travel-ask = Сколько минут занимает дорога в одну сторону? Это защита от пересекающихся рейсов.
adm-villages = Деревни
adm-villages-title = Деревни и сёла направления
adm-villages-near = У города { $city }
adm-village-add = + Деревня у города { $city }
adm-village-ask = Напишите название деревни или села.
adm-village-added = Добавлено: { $name }.
adm-late-trip-cancel =
    ⚠️ <b>Водитель отменил рейс с бронями в последний момент</b>
    { $driver }, { $phone }
    { $route }, { $when }
    Броней отменено: { $n }

setting-trip_horizon_days = Рейсы вперёд, дней
setting-trips_per_side_per_day = Рейсов в одну сторону в день
setting-trip_duplicate_minutes = Дубль рейса, ± минут
setting-request_escalate_minutes = Заявка админу через, мин
setting-late_cancel_hours = Поздняя отмена, часов до выезда
setting-confirm_ask_hours = Спросить «Едете?» за, часов
setting-confirm_wait_minutes = Ждать ответа «Едете?», мин
setting-violations_limit = Отмен и неявок до ограничения
setting-violations_period_days = Период подсчёта нарушений, дней
setting-big_baggage_prepay = Предоплата за багаж, ₽
setting-prepay_deadline_hours = Предоплата не позже, часов до выезда
setting-search_flex_hours = Гибкий поиск, ± часов
setting-search_exact_minutes = Точное время, ± минут
setting-trip_autoclose_hours = Закрыть рейс без «Доехали» через, часов
setting-driver_late_cancel_hours = Поздняя отмена рейса водителем, часов
setting-price_min = Минимальная цена места, ₽
setting-price_max = Максимальная цена места, ₽
setting-dispatcher_phone = Телефон диспетчера

## Дни и время

day-today = Сегодня
day-tomorrow = Завтра
hint-time = Напишите время цифрами, например 17:00.
step-of = Шаг { $n } из { $total }
action-not-available = Это действие уже недоступно.
prompt-cancelled = Хорошо, ничего не меняем.
cmd-start = Главное меню
cmd-help = Помощь и связь с диспетчером
miniapp-button = Барам

## Водитель: выложить рейс

drv-approved = ✅ Анкета одобрена! Теперь можно выкладывать рейсы — кнопка «Выложить рейс».
drv-rejected =
    Анкета водителя отклонена.
    Причина: { $reason }

    Исправьте данные и отправьте анкету ещё раз.
drv-photos-requested = Админ просит прислать фото машины заново: спереди с номером, сбоку, салон.
drv-suspended =
    Ваша работа водителем приостановлена админом.
    Причина: { $reason }
btn-fill-again = Заполнить анкету заново
btn-send-photos = Отправить фото
btn-edit-form = Изменить анкету
drv-cannot-post-pending = Анкета ещё на проверке. Как только админ её одобрит, мы напишем — и можно будет выкладывать рейсы.
drv-cannot-post-rejected = Анкета отклонена. Откройте «Мои данные», исправьте и отправьте её заново.
drv-cannot-post-photos_requested = Админ попросил прислать фото машины заново. Откройте «Мои данные».
drv-cannot-post-suspended = Ваша работа водителем приостановлена админом. Свяжитесь с диспетчером.
trip-new-or-repeat = Выложить такой же рейс, как в прошлый раз, или новый?
btn-repeat-last = 🔁 Повторить: { $route }, { $time }
btn-new-trip = Новый рейс
trip-ask-route = <b>Куда едете?</b>
trip-ask-day = <b>В какой день?</b>
trip-ask-time = <b>Во сколько выезжаете?</b> Выберите или напишите время, например 17:30.
btn-same-as-last = Как в прошлый раз: { $value }
trip-ask-pickup = <b>Как забираете пассажиров?</b>
pickup-door = От дома до дома
pickup-points = Из своих точек
pickup-mixed = Смешанно
trip-ask-points = Напишите ваши точки сбора через запятую, до пяти. Например: ТЦ Мега, Горки, Автовокзал.
trip-points-hint = Напишите хотя бы одну точку. Несколько — через запятую.
trip-ask-villages = <b>Заезжаете в деревни?</b> Доплату обсуждаете с пассажиром лично.
villages-yes = Да, заезжаю
trip-ask-villages-which = В какие? Напишите через запятую.
villages-all = Во все по пути
trip-ask-seats = <b>Сколько свободных мест?</b>
trip-ask-trunk = <b>Что с багажником?</b>
trunk-btn-free = Свободен
trunk-btn-half = Наполовину занят
trunk-btn-full = Почти занят
trip-ask-price = <b>Цена за одно место?</b> Напишите число в рублях.
trip-price-hint = Напишите цену числом, от { $min } до { $max }.
trip-summary =
    <b>Проверьте рейс</b>

    { $route }
    { $when }
    { $pickup }
    { $villages }
    Свободных мест: { $seats }
    { $trunk }
    Цена: { $price } за место
btn-publish = ✅ Выложить
trip-field-route = Направление
trip-field-day = День
trip-field-time = Время
trip-field-pickup = Как забираю
trip-field-villages = Деревни
trip-field-seats = Места
trip-field-trunk = Багажник
trip-field-price = Цена
trip-problem-not_approved = Выкладывать рейсы можно после одобрения анкеты.
trip-problem-past = Это время уже прошло. Выберите время позже.
trip-problem-horizon = Так далеко вперёд рейс выложить нельзя. Выберите день ближе.
trip-problem-limit = В этот день у вас уже есть столько рейсов в эту сторону, сколько разрешено. Выберите другой день.
trip-problem-duplicate = У вас уже есть рейс в эту сторону почти в это же время. Отмените его в «Мои рейсы» или выберите другое время.
trip-problem-overlap = Этот рейс пересекается с другим вашим рейсом: между ними не хватает времени на дорогу. Выберите другое время.
trip-problem-price = Цена вне допустимых границ. Исправьте цену.
trip-problem-seats = Мест больше, чем указано в анкете машины. Исправьте число мест.
trip-published = ✅ <b>Рейс выложен.</b> Пассажиры уже видят его в поиске.
trip-published-requests = { $n ->
    [one] На этот день есть { $n } заявка от пассажиров
    [few] На этот день есть { $n } заявки от пассажиров
   *[many] На этот день есть { $n } заявок от пассажиров
} — посмотрите в «Заявках».
trip-not-published = Рейс не выложен. Вернуться можно кнопкой «Выложить рейс».
btn-open-trip = Открыть рейс

## Поделиться рейсом в чате и ссылка на рейс

btn-share-phone = 📣 В чат — с телефоном
btn-share-nophone = 📣 В чат — без телефона
share-hint = 📣 <b>Расскажите о рейсе в чатах.</b> Пассажиры бронируют по ссылке в боте — отвечать на «места есть?» не придётся. Нажмите кнопку, выберите чат и проверьте текст перед отправкой.
share-title = 🚗 Еду { $route }
share-pickup-door = От дома до дома
share-pickup-points = Из точек: { $points }
share-pickup-mixed = От дома или из точек: { $points }
share-seats-price = Свободно: { $seats } · { $price } с человека
share-villages = Заеду в деревни по пути
share-cta = 📲 Забронировать место — по ссылке выше
link-trip-gone = Этот рейс уже недоступен: водитель отменил его или он уехал. Посмотрите другие рейсы.
link-trip-full = На этот рейс мест уже нет. Посмотрите другие рейсы или оставьте заявку.
link-own-trip = Это ваш рейс. Пассажиры, открыв эту ссылку, смогут забронировать место.
btn-book-trip = 📲 Забронировать место
btn-other-trips = 🔎 Другие рейсы
search-pinned-intro = Бронируем рейс <b>{ $route }</b>, { $when }. Осталось ответить на несколько вопросов: адреса, места и багаж.
search-pinned-gone = Этот рейс уже недоступен, поэтому покажу ближайшие по времени.

## Водитель: мои рейсы и поездка

drv-trips-title = <b>Мои рейсы</b>. Нажмите на рейс, чтобы увидеть пассажиров.
drv-trips-empty = Рейсов пока нет. Выложите первый.
drv-trip-passengers = <b>Пассажиры по порядку объезда.</b> Нажмите на пассажира: адрес, звонок, «Забрал».
drv-trip-no-passengers = Пока никто не забронировал.
phone-booking-short = По телефону
btn-departed = 🚗 Выехал
btn-arrived = 🏁 Доехали
btn-phone-booking = + Занято по телефону
btn-cancel-trip = Отменить рейс
btn-to-my-trips = ‹ Мои рейсы
btn-to-trip = ‹ К рейсу
drv-departed-toast = Пассажиры получили сообщение, что вы выехали.
drv-trip-completed = 🏁 Рейс завершён. Спасибо за поездку!
drv-cancel-trip-confirm = Отменить рейс? Все пассажиры получат сообщение об отмене.
btn-yes-cancel-trip = Да, отменить рейс
drv-trip-cancelled = Рейс отменён. Пассажиры получили сообщение.
drv-phone-booking-ask = Сколько мест заняли по телефону?
drv-phone-booking-done = Места убраны из поиска.
drv-phone-booking-failed = Не получилось: столько свободных мест уже нет.
btn-add-passenger-data = Добавить имя и телефон
phone-data-ask =
    Пришлите контакт пассажира: скрепка → Контакт.

    Или напишите имя и номер одним сообщением, например: Гульнара 89171234567.
phone-data-hint = Напишите имя и номер одним сообщением, например: Гульнара 89171234567.
phone-data-saved = Сохранено: { $name }, { $phone }.
drv-new-booking = <b>Новая бронь</b> · { $route }, { $when }
btn-accept = ✅ Принять
btn-decline = Отказать
drv-accepted-toast = Бронь принята. Пассажир получил ваши данные.
drv-declined-toast = Вы отказали. Место снова свободно.
btn-eta = { $n } мин
btn-picked-up = ✅ Забрал
btn-no-show = Не пришёл
btn-wrong-person = Сел другой человек
btn-prepay-received = Предоплата получена
btn-move-up = ⬆️ Выше в порядке объезда
btn-cancel-booking = Отменить бронь
btn-free-seats = Освободить места
drv-eta-toast = Пассажир получил сообщение.
drv-picked-up-toast = Отмечено: пассажир в машине.
drv-prepaid-toast = Отмечено. Пассажир получил подтверждение.
drv-wrong-person-toast = Сообщили заказчику и админу.
drv-no-show-confirm = Отметить, что { $name } не пришёл? Это останется в истории пассажира.
btn-yes-no-show = Да, не пришёл
drv-no-show-toast = Отмечено: пассажир не пришёл.
drv-cancel-booking-confirm = Отменить бронь ({ $name })? Пассажир получит сообщение.
btn-yes-cancel-booking = Да, отменить
drv-booking-cancelled-toast = Бронь отменена, место свободно.
drv-moved-up-toast = Порядок изменён.
drv-booking-cancelled = { $name } отменил бронь ({ $n ->
    [one] { $n } место
    [few] { $n } места
   *[many] { $n } мест
}) на { $when }. Место снова в поиске.
drv-booking-cancelled-late = ⚠️ <b>Поздняя отмена.</b> { $name } отменил бронь ({ $n ->
    [one] { $n } место
    [few] { $n } места
   *[many] { $n } мест
}) на { $when }. Место снова в поиске.
drv-passenger-confirmed = 👍 { $name } подтвердил поездку в { $when }.
drv-no-answer = { $name } не ответил на вопрос «Едете?». Позвоните: { $phone } — или подождите.
drv-no-prepay = От пассажира { $name } нет предоплаты за крупный багаж. До выезда меньше { $hours } ч — вы можете отменить эту бронь.

## Пассажир: поиск

search-ask-who = Кто едет?
who-self = Я сам
who-other = Другой человек
who-ask-name = Как зовут того, кто поедет? Напишите имя.
who-ask-phone = Телефон: { $name }. Напишите номер или пришлите контакт (скрепка → Контакт). Водитель будет звонить по нему.
who-phone-hint = Напишите номер телефона, например 89171234567, или пришлите контакт.
who-ask-type = Кто это?
who-type-adult = Взрослый
who-type-teen = Подросток 14–17 лет
who-type-child = Ребёнок до 14 лет
search-ask-from = Откуда едете?
search-ask-to = Куда едете?
search-place-note = Выберите город или сохранённый адрес.
btn-village = Деревня или село
search-ask-village = Какая деревня? Если вашей нет в списке — напишите диспетчеру через «Помощь».
search-village-warning = ℹ️ За деревню может быть доплата. Уточните у водителя.
search-ask-address = { $city }. Напишите улицу и дом. Или пришлите геопозицию: скрепка → Геопозиция.
search-address-hint = Напишите адрес словами: улица и дом. Например: ул. Ленина, 12.
address-geo = точка на карте
search-ask-day = Когда едете?
search-ask-time = В какое время?
time-btn-morning = Утром
time-btn-day = Днём
time-btn-evening = Вечером
time-btn-exact = Точное время
search-ask-exact-time = Во сколько? Напишите время, например 17:00.
search-time-passed = Это время уже прошло. Выберите день и время заново.
search-ask-seats = Сколько вас?
search-ask-child = Едет ребёнок до 7 лет? По правилам ему нужно детское кресло.
child-own = Да, кресло своё
child-driver = Да, нужно кресло водителя
search-ask-baggage = Сколько багажа?
baggage-btn-bag = Только сумка или рюкзак
baggage-btn-suitcase = Чемодан или большая сумка
baggage-btn-many = Много багажа
search-ask-baggage-note = Коротко напишите, что везёте. За крупный багаж — предоплата { $amount } водителю переводом.
search-ask-comment = Комментарий водителю
search-comment-note = Например: «Подъезд 3, позвоните заранее». Можно пропустить.
search-found = { $n ->
    [one] <b>Нашёлся { $n } рейс</b>
    [few] <b>Нашлось { $n } рейса</b>
   *[many] <b>Нашлось { $n } рейсов</b>
}
search-near = <b>Точно на это время рейса нет. Ближайшие рейсы:</b>
search-also-near = <b>Ещё рядом по времени:</b>
search-pick = Выберите рейс. Не подошло — оставьте заявку, её увидят водители.
search-none = Рейсов на это время пока нет. Оставьте заявку — её увидят все водители направления.
btn-leave-request = 🔔 Оставить заявку
search-ask-point = { $driver } забирает из своих точек. Где вам удобно сесть?
point-my-address = От моего адреса
summary-title = Проверьте поездку
summary-pay-note = { " " }— оплата водителю, наличными или переводом
summary-prepay-note = За крупный багаж — предоплата { $amount } водителю. Реквизиты придут после того, как водитель примет бронь.
search-field-who = Кто едет
search-field-from = Откуда
search-field-to = Куда
search-field-when = Когда
search-field-seats = Сколько мест
search-field-baggage = Багаж
search-field-comment = Комментарий
search-cancelled = Поиск закрыт. Начать заново — кнопка «Найти поездку».
search-repeat-intro =
    Повторяем поездку:
    { $from } → { $to }

    Осталось выбрать день и время.
bk-fail-no_seats = В этом рейсе уже нет столько мест. Выберите другой рейс.
bk-fail-own_trip = Это ваш собственный рейс.
bk-fail-duplicate = Этот пассажир уже записан в этот рейс.
bk-fail-blocked = Бронирование недоступно. Свяжитесь с диспетчером.
bk-sent = ✅ <b>Заявка на бронь отправлена водителю.</b> Как только он подтвердит — мы напишем.
bk-sent-needs-admin = <b>Бронь отправлена на подтверждение диспетчеру</b>: у вас были поздние отмены или неявки. Мы напишем, когда её рассмотрят.
btn-need-return = 🔁 Нужно и обратно
save-address-offer = Запомнить адрес, чтобы в следующий раз выбрать его одной кнопкой?
save-address-ask-label = Как назвать этот адрес?
addr-label-home = Дом
addr-label-dorm = Общага
addr-label-work = Работа
addr-label-other = Другое
save-address-done = Сохранено: { $label } — { $address }.

## Пассажир: бронь и поездка

bk-accepted = ✅ <b>Водитель подтвердил бронь.</b>
bk-declined = Водитель не смог взять вас в рейс { $when }. Найдите другой рейс или оставьте заявку — кнопка «Найти поездку».
bk-declined-by-admin = Диспетчер отклонил бронь. Если это ошибка — напишите через «Помощь».
bk-cancelled-by-driver = Водитель отменил вашу бронь на { $when }. Найдите другой рейс — кнопка «Найти поездку».
trip-cancelled-for-passenger = ❌ <b>Водитель отменил рейс</b> { $route }, { $when }. Найдите другой рейс — кнопка «Найти поездку».
trip-cancelled-by-admin = Админ отменил ваш рейс { $when }.
bk-prepay-received = ✅ Водитель получил предоплату за багаж. Бронь подтверждена окончательно.
bk-prepay-reminder = Напоминаем: водитель ждёт предоплату за крупный багаж. Без неё он может отменить бронь.
btn-open-booking = Открыть поездку
ask-going = <b>Едете сегодня в { $time }?</b> { $route }
btn-yes-going = ✅ Да, еду
bk-confirmed-thanks = Спасибо! Водитель знает, что вы едете.
ride-driver-departed = 🚗 Водитель { $driver } выехал. Телефон: { $phone }
ride-eta = { $n ->
    [one] 🚗 Водитель будет примерно через { $n } минуту
    [few] 🚗 Водитель будет примерно через { $n } минуты
   *[many] 🚗 Водитель будет примерно через { $n } минут
}. Пожалуйста, будьте готовы.
ride-picked-up-other = ✅ { $name } в машине: { $car }, { $plate }, водитель { $driver }.
ride-arrived-self = 🏁 Поездка завершена. Спасибо, что едете с «Барам»!
ride-arrived-other = 🏁 { $name } доехал(а). Поездка завершена.
ride-no-show = Водитель отметил, что пассажир не пришёл на рейс { $when }. Если это ошибка — напишите через «Помощь».
ride-wrong-person = 🚨 Водитель сообщил: в машину сел не тот человек, которого вы записали ({ $name }, рейс { $when }). Свяжитесь с водителем или диспетчером.
complaint-wrong-person-text = Водитель сообщил: вместо пассажира «{ $name }» сел другой человек.
my-trips-title = <b>Мои поездки</b>. 🟢 — предстоящие, ▫️ — прошлые. Нажмите, чтобы открыть.
my-trips-empty = Поездок пока нет. Нажмите «Найти поездку».
btn-repeat = 🔁 Повторить
btn-reverse = ↩️ Обратно
btn-to-my-trips-passenger = ‹ Мои поездки
btn-keep-booking = Нет, оставить
bk-cancel-confirm = Отменить бронь? До выезда больше { $hours } ч — это свободная отмена.
bk-cancel-confirm-late = До выезда меньше { $hours } ч — это будет <b>поздняя отмена</b>. Она останется в вашей истории: после { $limit } поздних отмен или неявок за месяц бронь возможна только с подтверждением диспетчера. Отменить?
bk-cancelled-free = Бронь отменена. Водитель получил сообщение.
bk-cancelled-late = Бронь отменена. Это поздняя отмена — водитель получил срочное сообщение.
violations-count = Поздних отмен и неявок за месяц: { $n } из { $limit }.
violations-restricted = ⚠️ У вас накопились поздние отмены или неявки. Следующие брони будет подтверждать диспетчер.

## Заявки

request-short = Заявка
request-title = Ваша заявка
request-cancelled = Заявка отменена.
btn-cancel-request = Отменить заявку
request-status-open = ждёт водителя
request-status-taken = водитель найден
request-status-closed = закрыта
request-status-cancelled = отменена пассажиром
request-status-expired = время прошло
req-sent = { $minutes ->
    [one] 🔔 <b>Заявка отправлена водителям.</b> Если за { $minutes } минуту никто не возьмёт — передадим диспетчеру.
    [few] 🔔 <b>Заявка отправлена водителям.</b> Если за { $minutes } минуты никто не возьмёт — передадим диспетчеру.
   *[many] 🔔 <b>Заявка отправлена водителям.</b> Если за { $minutes } минут никто не возьмёт — передадим диспетчеру.
}
req-new-for-driver = 🔔 <b>Заявка от пассажира</b> — рейса на это время нет.
req-offer-from-admin = 🔔 <b>Диспетчер просит взять заявку</b>
btn-take-request = Беру
req-list-title = Заявки пассажиров
req-list-empty = Заявок сейчас нет. Мы напишем, когда появится новая.
req-gone = Эту заявку уже взяли или отменили.
req-need-trip = Чтобы взять заявку, сначала выложите рейс на этот день в эту сторону. Потом нажмите «Обновить».
req-choose-trip = В какой рейс берёте пассажира?
req-into-trip = В рейс { $time } (свободно: { $free })
req-take-failed = Не получилось: в рейсе не хватает мест.
req-taken-driver = ✅ <b>Заявка ваша.</b> Пассажир добавлен в рейс и получил ваши данные.
req-taken = ✅ <b>Водитель взял вашу заявку.</b>
req-trip-appeared = 🚗 <b>Появился рейс на ваш день.</b> Ваша заявка ещё открыта.
btn-ride-with = Еду с ним
req-escalated-for-passenger = Пока никто из водителей не взял заявку. Передали её диспетчеру — он подберёт машину и напишет вам.
req-closed-no-driver = К сожалению, машину на это время найти не удалось. Посмотрите ближайшие рейсы — кнопка «Найти поездку».
req-expired = Время вашей заявки прошло, водитель не нашёлся. Создайте новую — кнопка «Найти поездку».

## Помощь, жалобы, сохранённое

help-text =
    <b>Барам — попутчики Буинск ⇄ Казань</b>

    • Пассажир находит рейс и бронирует место. Оплата — водителю, наличными или переводом.
    • Отмена больше чем за { $hours } ч до выезда — свободная. Позже — «поздняя отмена», она остаётся в истории.
    • Водитель публикует рейсы после проверки анкеты.

    Что-то пошло не так — нажмите «Пожаловаться», сообщение уйдёт диспетчеру.
help-dispatcher = ☎️ Диспетчер: { $phone }
btn-saved = Мои адреса и люди
complaint-ask = Опишите, что случилось. Сообщение получит диспетчер.
complaint-sent = Спасибо, сообщение отправлено диспетчеру. Он свяжется с вами.
saved-addresses-title = Сохранённые адреса
saved-people-title = Сохранённые пассажиры
saved-empty = пока пусто

## Канал

channel-title = Рейсы на { $day }
channel-seats = { $n ->
    [one] { $n } место
    [few] { $n } места
   *[many] { $n } мест
}
channel-no-seats = мест нет
channel-villages = деревни
channel-child-seat = кресло
channel-empty = Рейсов на этот день пока нет.
channel-footer = Забронировать место — в боте, кнопка ниже.
channel-button = 🚗 Найти поездку
