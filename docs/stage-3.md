# Stage 3 — Universal Catalog

Stage 3 расширяет существующий NestJS modular monolith единым каталогом товаров
и услуг. Identity, Clerk authentication, membership и permission guards Stage 2
остаются источником авторизации. `apps/ai` не изменён.

## Модель каталога

`CatalogItem` — карточка PRODUCT или SERVICE с категорией, описанием, статусом
и флагом `trackInventory`. SERVICE всегда имеет `trackInventory=false`;
это проверяется DTO/domain logic и PostgreSQL CHECK constraint.

`CatalogVariant` — единица, на которую смогут ссылаться последующие модули.
SKU, barcode, selling/cost price и unit принадлежат варианту. Даже карточка
без options получает default variant. Item и default variant создаются одной
транзакцией; ошибка любого вложенного значения откатывает всю операцию.

`CatalogCategory` — иерархия внутри организации. Backend проверяет весь путь
родителей и отклоняет циклы, включая конкурентные попытки. Родитель и категория
нового назначения должны быть активны. Уже назначенную архивную категорию можно
сохранить при редактировании item. Архивирование родителя с активными детьми
отклоняется: сначала нужно перенести или архивировать детей.

`CatalogOption` и `CatalogOptionValue` описывают характеристики вариантов одного
item, например Size → M/L. `VariantOptionValue` связывает вариант со значением:
не более одного значения каждого option, строго из того же item и tenant.
Автоматическая генерация комбинаций отсутствует. Используемые options/values
нельзя архивировать до удаления их назначений.

`CustomFieldDefinition` и `CustomFieldOption` описывают поля организации.
`CatalogItemCustomFieldValue` хранит проверенные значения в JSONB, по одной записи
на пару item/field. Это поля карточки, а не вариантные options.

## База данных и миграция

Миграция `20260929182020_universal_catalog` добавляет девять таблиц:

- `CatalogItem`, `CatalogVariant`, `CatalogCategory`;
- `CatalogOption`, `CatalogOptionValue`, `VariantOptionValue`;
- `CustomFieldDefinition`, `CustomFieldOption`, `CatalogItemCustomFieldValue`.

Enums: `CatalogItemType`, `UnitOfMeasure`, `CustomFieldType`.
Единицы: PIECE, KILOGRAM, GRAM, LITER, MILLILITER, METER, CENTIMETER,
HOUR, MINUTE, SERVICE, OTHER.

Составные foreign keys включают organizationId, а для вариантных options ещё
catalogItemId. БД запрещает связи item/category, variant/item, option/value,
variant/option-value и item/custom-field между разными организациями.

Partial unique index гарантирует не более одного default variant; deferred
constraint triggers проверяют наличие ровно одного на commit. Default variant
всегда активен (CHECK). API не позволяет сменить default или удалить вариант:
для снятия карточки с использования архивируется item. Архивные записи сохраняют
идентификаторы, связи, цены и уникальность SKU/barcode.

Индексы покрывают tenant + status/date, category, type, name/id, updatedAt/id,
варианты item, tenant SKU/barcode и поиск custom field assignments. CHECK constraints
дополнительно запрещают отрицательные цены и self-parent категории.

Все catalog writes выполняются в транзакции с advisory lock на organizationId.
Это предотвращает гонки проверки циклов, лимитов и required fields. Блокировка
действует только до конца транзакции; чтение не блокируется этим механизмом.
Это сознательно грубая гранулярность для Stage 3; при высокой частоте записей
одной организации потребуется оценить contention. `maxWait=5s`, timeout=10s.
Raw SQL использует параметризованные Prisma tagged templates. Migration trigger
обращается к таблицам через безопасный `TG_TABLE_SCHEMA`, включая тестовые schemas.

Применение: `pnpm --filter @saas/api db:migrate`. Старые migrations не переписаны,
`db push` не используется. Integration setup сначала применяет Stage 2, создаёт
старую организацию с системными ролями, затем применяет Stage 3 в случайной schema
отдельной test database. Проверяется также повторный permission backfill.

## Цены, SKU и barcode

Цены хранятся в PostgreSQL `numeric(19,4)` / `Prisma.Decimal`. Вход и выход API —
строки. Например `"1234567890.1234"` проходит БД → JSON без потери точности,
а `"0.01"` возвращается как `"0.0100"`. Запрещены отрицательные значения, JS numbers,
экспоненциальная запись, NaN/Infinity, более 15 целых или четырёх дробных цифр.
`costPrice=null` означает отсутствие данных; sellingPrice обязателен.

Валюта читается из `Organization.defaultCurrency`; у variant нет своей валюты.
Существующая смена defaultCurrency меняет валюту отображения всего каталога,
но не пересчитывает числовые цены. Валютная конвертация и исторические документы
не входят в Stage 3; перед сменой валюты требуется отдельно согласовать новые цены.

SKU: trim, uppercase, разрешены ASCII letters/digits и `._/-`, уникальность
внутри организации. Barcode: trim, строка с сохранением ведущих нулей,
регистрозависимая уникальность внутри организации. Пустая строка становится null;
несколько null допустимы. Одинаковые SKU/barcode в разных tenants разрешены.
Конфликты возвращают 409 с `SKU_ALREADY_EXISTS` / `BARCODE_ALREADY_EXISTS`.
Другие unique conflicts дают `CATALOG_VALUE_ALREADY_EXISTS`, без Prisma details.

## Custom fields

| Тип          | JSON value и проверки                                             |
| ------------ | ----------------------------------------------------------------- |
| TEXT         | Непустая trimmed string, максимум 2000 символов                   |
| NUMBER       | Decimal string, до 30 целых и 8 дробных цифр; знак минус разрешён |
| BOOLEAN      | Настоящий JSON boolean, включая false                             |
| DATE         | Существующая календарная дата `YYYY-MM-DD`                        |
| SELECT       | UUID активного option именно этого field                          |
| MULTI_SELECT | Непустой массив уникальных UUID активных options этого field      |

Пример assignment: `{"fieldId":"<uuid>","value":["<option-uuid>"]}`.
`value=null` удаляет assignment, если это не нарушает required rule.
Отсутствие field в PATCH сохраняет его прежнее значение.

`key` и `type` после создания неизменны; option `value` также неизменен.
Названия, labels, порядок, required и active можно менять. Choice field должен
содержать хотя бы один активный option. Используемый option архивировать нельзя.
Для существующего каталога новый required field сначала создаётся optional,
заполняется у всех активных items и только затем становится required.
Создание/активация item проверяет все активные required fields.

Архивный field не принимает новых значений; ранее записанные значения остаются
доступны в detail. Повторное включение required field проверяет существующие items.
Field validation и запись выполняются в одной транзакции.

## Tenant isolation и permissions

Все endpoints требуют проверенный JWT, ACTIVE membership и существующие
`OrganizationMembershipGuard` / `PermissionsGuard`. organizationId берётся из
проверенного route context, а не из body. Запросы к сущностям включают tenant
и родительские ID; foreign/unavailable resource возвращает 404. Недостаточные
permissions дают 403, отсутствие authentication — 401.

| Системная роль | catalog.view | catalog.manage |
| -------------- | ------------ | -------------- |
| OWNER          | Да           | Да             |
| ADMIN          | Да           | Да             |
| MEMBER         | Да           | Нет            |

Миграция добавляет эти grants существующим системным ролям через идемпотентный
`INSERT ... ON CONFLICT DO NOTHING`. Новые организации получают те же grants
из общего permission registry. Пользовательские роли автоматически не расширяются.

## API

Общий префикс: `/api/v1/organizations/:organizationId/catalog`.
GET требует `catalog.view`, POST/PATCH — `catalog.manage`.

| Метод | Путь                                               | Назначение               |
| ----- | -------------------------------------------------- | ------------------------ |
| GET   | `/items`                                           | Поиск и список           |
| POST  | `/items`                                           | Item + default variant   |
| GET   | `/items/:itemId`                                   | Подробная карточка       |
| PATCH | `/items/:itemId`                                   | Изменение/архивирование  |
| GET   | `/items/:itemId/variants`                          | Варианты                 |
| POST  | `/items/:itemId/variants`                          | Создание варианта        |
| PATCH | `/items/:itemId/variants/:variantId`               | Изменение/архивирование  |
| GET   | `/items/:itemId/options`                           | Options и values         |
| POST  | `/items/:itemId/options`                           | Создание option          |
| PATCH | `/items/:itemId/options/:optionId`                 | Изменение option         |
| POST  | `/items/:itemId/options/:optionId/values`          | Создание value           |
| PATCH | `/items/:itemId/options/:optionId/values/:valueId` | Изменение value          |
| GET   | `/categories`                                      | Список категорий         |
| POST  | `/categories`                                      | Создание категории       |
| PATCH | `/categories/:categoryId`                          | Изменение/архивирование  |
| GET   | `/custom-fields`                                   | Definitions с options    |
| POST  | `/custom-fields`                                   | Создание definition      |
| PATCH | `/custom-fields/:fieldId`                          | Изменение/архивирование  |
| POST  | `/custom-fields/:fieldId/options`                  | Добавление choice option |
| PATCH | `/custom-fields/:fieldId/options/:optionId`        | Изменение choice option  |

DTO schemas и все catalog operations доступны в development Swagger `/api/docs`
и `/api/docs-json`. В production Swagger отключён. UUID, enums, вложенные DTO,
длины строк и размеры массивов проверяются global validation pipe. Неизвестные
поля, включая organizationId, createdAt и isDefault, отклоняются.

Минимальное создание:

```json
{
  "type": "PRODUCT",
  "name": "T-shirt",
  "trackInventory": true,
  "defaultVariant": {
    "sku": "shirt-m",
    "barcode": "001234567890",
    "sellingPrice": "25.5000",
    "costPrice": "12.0000",
    "unit": "PIECE"
  }
}
```

## Поиск, pagination и границы нагрузки

`GET /items`: `q` ищет подстроку name/SKU/barcode только внутри tenant;
SQL LIKE metacharacters экранируются. Фильтры: `type`, `categoryId`, `isActive`.
По умолчанию возвращаются активные items. `sort` принимает только name (ascending),
createdAt или updatedAt (descending). Стабильный tie-breaker — UUID.
`cursor` содержит sort/value/id; изменение sort требует нового cursor.
Keyset pagination не является snapshot: изменение сортируемых полей во время
обхода может переместить записи. Фильтры также следует сохранять между страницами.

Размер страницы по умолчанию 50, максимум 100; web использует 25. List содержит
basic item, category, currency и один default variant, без всех variants/custom
fields. Prisma relations загружаются пакетно; нет запроса variant/category на
каждую строку в цикле приложения. Остальные списки используют UUID cursor.

Ограничения домена, включая архивные записи, если не указано иначе:

- 100 variants и 10 options на item;
- 100 values на option и 100 choice options на custom field;
- 100 активных custom fields и 1000 definitions всего на организацию;
- не более 100 custom field assignments в одном запросе;
- detail содержит до 100 variants, 10 options и 1000 сохранённых field values;
- проверка пути категории ограничена 64 шагами;
- Fastify body limit — 1 MiB, строковые и вложенные лимиты дополнительно задаются DTO.

## Frontend

В organization navigation добавлен Catalog. Используется существующий server-only
API client и Clerk token forwarding; tokens не сохраняются в localStorage.

- `/app/[organizationId]/catalog`: поиск, фильтры, таблица и cursor navigation.
- `/app/[organizationId]/catalog/new`: PRODUCT/SERVICE, категория, default variant,
  SKU/barcode, цены, unit, inventory flag и активные custom fields.
- `/app/[organizationId]/catalog/[itemId]`: карточка, редактирование, варианты,
  options/values и сохранённые custom fields, включая архивные.
- `/app/[organizationId]/catalog/categories`: hierarchy breadcrumbs, create/edit/archive.
- `/app/[organizationId]/catalog/custom-fields`: definitions и choice options.

SERVICE автоматически выключает inventory flag. Required fields имеют HTML
validation, но окончательная проверка выполняется backend. MEMBER видит read-only
страницы; кнопки управления доступны только catalog.manage. Server actions явно
собирают разрешённые поля, а API заново проверяет permission и DTO. Текст выводится
обычными React children, без raw HTML.

## Tests и проверка

`catalog.scenarios.ts` расширяет integration suite Stage 2: реальный PostgreSQL,
Redis, локальный JWKS и подписанные JWT, без auth bypass или настоящих Clerk keys.
Добавлены 13 групп catalog scenarios; вместе с существующими API tests — 28 tests.

Покрыты OWNER/ADMIN/MEMBER, permission migration, rollback при принудительной
ошибке вставки default variant, SERVICE rule, tenant-scoped SKU/barcode conflicts
и concurrent SKU creation, SQL composite constraints, IDOR/search leakage,
категории и concurrent cycles, default variant constraints, variant options,
шесть типов custom fields, required/archive/immutable rules, Decimal precision,
search/filter/sort, Unicode cursor, pagination limits и mass assignment.

Запуск из корня после настройки отдельной test database:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm --filter @saas/api db:validate
pnpm --filter @saas/api db:migrate
```

Существующий CI уже выполняет migrations, integration tests и Docker smoke tests;
специальные credentials или отдельный bypass для Stage 3 не нужны.

Для ручной end-to-end проверки web нужны реальные значения
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `AUTH_ISSUER`,
`AUTH_JWKS_URL` и согласованный `AUTH_AUTHORIZED_PARTIES`. После настройки проверить
вход, создание PRODUCT/SERVICE, custom fields, варианты, архивирование, фильтры
и read-only MEMBER во втором аккаунте. Автоматические backend tests не заменяют
эту проверку браузера с Clerk.

## Граница этапа

`trackInventory` — только свойство каталога. Количества, stock ledger, reservations,
sales/orders, payments, media storage, audit log и AI integration не реализованы.
Следующие модули должны ссылаться на `CatalogVariant.id`. Stage 4 не начат.
