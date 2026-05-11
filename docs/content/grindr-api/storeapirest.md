# StoreApiRest

Store endpoints require [Authorization](/grindr-api/api-authorization).

## Store catalogs

```
GET /v3/store/googleplay/products/store
GET /v1/store/googleplay/products/profile_drawer
GET /v2/store/googleplay/products/{oneStopShopCategory}
```

Path:

- `oneStopShopCategory` — string

Response:

`StoreCatalogDto`.

## Shop catalogs

```
GET /v1/shop/googleplay/products/{oneStopShopCategory}
GET /v1/shop/googleplay/products-with-details/{oneStopShopCategory}
```

Path:

- `oneStopShopCategory` — string

Responses:

- `ShopCatalogDto`
- `ProductsWithDetailsResponseDto`

## Attribution token

```
POST /v1/store/attribution/tokens
POST /v1/consumables/attribution/tokens
```

Body (`PaymentTokenRequestDto`):

- `priceLocale` — string
- `currencyCode` — string
- `rightNowPostId` — long integer or `null`
- `source` — string
- `productIdentifier` — string

Response:

`PaymentTokenResponseDto`:

- `token` — string

## Consumable purchase

```
POST /v1/store/googleplay/consumables/purchases
```

Body (`ConsumableTokenRequestDto`):

- `purchaseToken` — string
- `vendorProductId` — string

Response:

Empty.

## Subscription purchase

```
POST /v1/store/googleplay/subscriptions/purchases
```

Body (`SubscriptionTokenRequestDto`):

- `purchaseToken` — string

Response:

Empty.

## Restore subscriptions

```
POST /v1/store/googleplay/subscriptions/restorations
```

Body (`SubscriptionRestorationRequestDto`):

- `purchaseTokens` — array of strings

Response:

`SubscriptionRestorationResponseDto`:

- `restoredSubscriptionsCount` — integer

## Get subscriptions

```
GET /v3/me/subscriptions
```

Query:

- `status` — string, optional
- `platform` — string, optional

Response:

`SubscriptionResponseDto`:

- `subscriptions` — array of `SubscriptionItemDto`
