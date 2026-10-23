-- Idempotent demo seed: one neighborhood (Echo Park, LA), 15 live storefronts with real menus,
-- 2 live drops, deals, reviews, a pending merchant, plus demo people with order history.
-- Every statement is safe to re-run: inserts are keyed on natural keys and skipped when present.

-- ---------------------------------------------------------------- neighborhood
insert into neighborhoods (name, slug, city, timezone, boundary, center)
values (
  'Echo Park', 'echo-park', 'Los Angeles', 'America/Los_Angeles',
  st_setsrid(st_geomfromtext('POLYGON((
    -118.2720 34.0680, -118.2500 34.0680, -118.2500 34.0870,
    -118.2720 34.0870, -118.2720 34.0680))'), 4326)::geography,
  st_setsrid(st_makepoint(-118.2605, 34.0783), 4326)::geography
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------- people
insert into profiles (display_name, email, phone, locale, home_location, home_address, neighborhood_id)
select v.name, v.email, v.phone, v.locale,
       st_setsrid(st_makepoint(v.lng, v.lat), 4326)::geography,
       v.address,
       (select id from neighborhoods where slug = 'echo-park')
from (values
  ('Ava Ramos',    'neighbor@localloop.dev', '+12135550101', 'en', 34.07830, -118.26050, '1440 W Sunset Blvd, Los Angeles, CA'),
  ('Marisol Vega', 'marisol@localloop.dev',  '+12135550102', 'es', 34.07910, -118.25880, '1616 Echo Park Ave, Los Angeles, CA'),
  ('Teo Alvarez',  'teo@localloop.dev',      '+12135550103', 'en', 34.07680, -118.26210, '1122 Echo Park Ave, Los Angeles, CA'),
  ('Neighborhood Ops', 'ops@localloop.dev',  '+12135550100', 'en', 34.07830, -118.26050, 'Echo Park, Los Angeles, CA'),
  ('Ruben Ochoa',  'gallo@localloop.dev',    '+12135550111', 'es', 34.07950, -118.26050, '1420 W Sunset Blvd, Los Angeles, CA'),
  ('Elena Duarte', 'bakery@localloop.dev',   '+12135550112', 'es', 34.07780, -118.25900, '1512 W Sunset Blvd, Los Angeles, CA'),
  ('Sam Okafor',   'market@localloop.dev',   '+12135550113', 'en', 34.08010, -118.26200, '1702 Echo Park Ave, Los Angeles, CA'),
  ('Yuki Tanaka',  'cafe@localloop.dev',     '+12135550114', 'en', 34.07820, -118.26150, '1601 W Sunset Blvd, Los Angeles, CA'),
  ('Dee Marlow',   'night@localloop.dev',    '+12135550115', 'en', 34.07880, -118.26000, '1555 W Sunset Blvd, Los Angeles, CA')
) as v(name, email, phone, locale, lat, lng, address)
on conflict (email) do nothing;

insert into user_roles (user_id, role)
select p.id, v.role::user_role
from (values
  ('neighbor@localloop.dev', 'neighbor'),
  ('marisol@localloop.dev', 'neighbor'),
  ('teo@localloop.dev', 'neighbor'),
  ('ops@localloop.dev', 'admin'),
  ('gallo@localloop.dev', 'merchant'),
  ('bakery@localloop.dev', 'merchant'),
  ('market@localloop.dev', 'merchant'),
  ('cafe@localloop.dev', 'merchant'),
  ('night@localloop.dev', 'merchant')
) as v(email, role)
join profiles p on p.email = v.email
on conflict (user_id, role) do nothing;

-- ---------------------------------------------------------------- storefronts
insert into merchants (
  owner_id, neighborhood_id, name, slug, category, description, phone, address, location,
  hours, status, accepts_pickup, accepts_delivery, featured
)
select o.id,
       (select id from neighborhoods where slug = 'echo-park'),
       v.name, v.slug, v.category, v.descr, v.phone, v.address,
       st_setsrid(st_makepoint(v.lng, v.lat), 4326)::geography,
       (select jsonb_object_agg(d, jsonb_build_array(jsonb_build_array(v.open_t, v.close_t)))
          from unnest(array['sun','mon','tue','wed','thu','fri','sat']) as d),
       v.status::merchant_status, v.pickup, v.delivery, v.featured
from (values
  ('gallo@localloop.dev', 'Tacos El Gallo', 'tacos-el-gallo', 'tacos',
   'Sonoran-style tacos on handmade tortillas, salsa bar, trompo fired daily.',
   '+12135550141', '1420 W Sunset Blvd', 34.07950, -118.26050, '08:00', '22:00', 'live', true, false, true),
  ('bakery@localloop.dev', 'Echo Park Bakery', 'echo-park-bakery', 'bakery',
   'Neighborhood bakery since 1998. Bread out of the oven at 6:30am.',
   '+12135550142', '1512 W Sunset Blvd', 34.07780, -118.25900, '06:30', '18:00', 'live', true, false, true),
  ('market@localloop.dev', 'La Bodega Verde', 'la-bodega-verde', 'bodega',
   'Corner bodega with cold cases, produce crates and daily aguas frescas.',
   '+12135550143', '1702 Echo Park Ave', 34.08010, -118.26200, '07:00', '23:00', 'live', true, false, false),
  ('market@localloop.dev', 'Sunset Produce Stand', 'sunset-produce-stand', 'produce',
   'Farm stand produce driven in from Oxnard before sunrise.',
   '+12135550144', '1301 W Sunset Blvd', 34.07650, -118.25830, '08:00', '19:00', 'live', true, false, true),
  ('gallo@localloop.dev', 'Carniceria Ramirez', 'carniceria-ramirez', 'meat_fish',
   'Full-service carniceria: marinated asada, house chorizo, custom cuts.',
   '+12135550145', '1735 Echo Park Ave', 34.08120, -118.26350, '08:00', '20:00', 'live', true, false, false),
  ('cafe@localloop.dev', 'Cafe Alameda', 'cafe-alameda', 'coffee',
   'Small-batch roaster and pastry counter facing the lake.',
   '+12135550146', '1601 W Sunset Blvd', 34.07820, -118.26150, '06:00', '17:00', 'live', true, false, true),
  ('market@localloop.dev', 'Bulk & Barrel', 'bulk-and-barrel', 'pantry',
   'Refill shop: grains, nuts, oils and honey by the pound.',
   '+12135550147', '1120 Echo Park Ave', 34.07480, -118.25700, '09:00', '20:00', 'live', true, false, false),
  ('cafe@localloop.dev', 'Flores de Echo', 'flores-de-echo', 'flowers',
   'Flower stand on the corner, bouquets arranged every morning.',
   '+12135550148', '1250 Echo Park Ave', 34.07600, -118.25980, '08:00', '18:00', 'live', true, false, false),
  ('cafe@localloop.dev', 'Halal Corner', 'halal-corner', 'halal',
   'Halal cart turned storefront: chicken over rice, gyros, baklava.',
   '+12135550149', '1830 W Sunset Blvd', 34.07900, -118.26500, '10:00', '22:00', 'live', true, false, false),
  ('cafe@localloop.dev', 'Verde Vegan Kitchen', 'verde-vegan-kitchen', 'vegan',
   'Plant-based Mexican comfort food, cashew queso made in house.',
   '+12135550150', '1042 W Sunset Blvd', 34.07700, -118.25600, '11:00', '21:00', 'live', true, false, true),
  ('bakery@localloop.dev', 'Panaderia La Espiga', 'panaderia-la-espiga', 'bakery',
   'Bolillos and conchas baked every two hours, pan dulce by the tray.',
   '+12135550151', '1755 Echo Park Ave', 34.08050, -118.25850, '05:30', '19:00', 'live', true, false, false),
  ('gallo@localloop.dev', 'Mariscos El Pescador', 'mariscos-el-pescador', 'meat_fish',
   'Fish market and mariscos counter. Shucked to order.',
   '+12135550152', '950 Echo Park Ave', 34.07350, -118.26000, '09:00', '19:00', 'live', true, true, false),
  ('market@localloop.dev', 'Corner Mart 24', 'corner-mart-24', 'bodega',
   'Open all night: water, snacks, chargers, sandwiches made daily.',
   '+12135550153', '1901 W Sunset Blvd', 34.08200, -118.25950, '00:00', '23:59', 'live', true, false, false),
  ('gallo@localloop.dev', 'Taqueria La Palma', 'taqueria-la-palma', 'tacos',
   'Suadero and cabeza tacos, champurrado in the winter.',
   '+12135550154', '1020 Echo Park Ave', 34.07420, -118.26200, '10:00', '23:00', 'live', true, false, false),
  ('market@localloop.dev', 'Echo Park Co-op', 'echo-park-co-op', 'produce',
   'Member-run co-op: produce boxes, bulk staples, kombucha refills.',
   '+12135550155', '1850 W Sunset Blvd', 34.08150, -118.25650, '08:00', '20:00', 'live', true, false, false),
  ('cafe@localloop.dev', 'Alameda Kombucha Co.', 'alameda-kombucha', 'pantry',
   'Brewery and taproom opening soon, waiting on neighborhood approval.',
   '+12135550156', '1234 Alameda St', 34.07550, -118.25500, '11:00', '20:00', 'pending', true, false, false),
  ('night@localloop.dev', 'Night Owl Deli', 'night-owl-deli', 'bodega',
   'Late-night sandwiches. Currently paused while the kitchen is rebuilt.',
   '+12135550157', '1555 W Sunset Blvd', 34.07880, -118.26000, '18:00', '02:00', 'paused', true, true, false)
) as v(owner_email, name, slug, category, descr, phone, address, lat, lng, open_t, close_t, status, pickup, delivery, featured)
join profiles o on o.email = v.owner_email
on conflict (slug) do nothing;

-- Closed Sundays, and the late-night deli wraps past midnight.
update merchants set hours = hours - 'sun'
  where slug in ('echo-park-bakery', 'flores-de-echo', 'panaderia-la-espiga') and hours ? 'sun';
update merchants set hours = jsonb_set(hours, '{mon}', '[["18:00","02:00"]]'::jsonb, false)
  where slug = 'night-owl-deli' and hours ? 'mon';

-- ---------------------------------------------------------------- menus
insert into menu_categories (merchant_id, name, sort)
select m.id, v.name, v.sort
from (values
  ('tacos-el-gallo', 'Tacos', 1), ('tacos-el-gallo', 'Sides', 2), ('tacos-el-gallo', 'Drinks', 3),
  ('echo-park-bakery', 'Bakery', 1), ('echo-park-bakery', 'Coffee', 2),
  ('la-bodega-verde', 'Cold Case', 1), ('la-bodega-verde', 'Pantry', 2),
  ('sunset-produce-stand', 'Produce', 1),
  ('carniceria-ramirez', 'Meat', 1), ('carniceria-ramirez', 'Marinated', 2),
  ('cafe-alameda', 'Coffee', 1), ('cafe-alameda', 'Pastries', 2),
  ('bulk-and-barrel', 'Bulk', 1), ('bulk-and-barrel', 'Pantry', 2),
  ('flores-de-echo', 'Bouquets', 1), ('flores-de-echo', 'Plants', 2),
  ('halal-corner', 'Plates', 1), ('halal-corner', 'Sweets', 2),
  ('verde-vegan-kitchen', 'Bowls', 1), ('verde-vegan-kitchen', 'Snacks', 2),
  ('panaderia-la-espiga', 'Pan Dulce', 1), ('panaderia-la-espiga', 'Bread', 2),
  ('mariscos-el-pescador', 'Mariscos', 1), ('mariscos-el-pescador', 'Market', 2),
  ('corner-mart-24', 'Snacks', 1), ('corner-mart-24', 'Essentials', 2),
  ('taqueria-la-palma', 'Tacos', 1), ('taqueria-la-palma', 'Drinks', 2),
  ('echo-park-co-op', 'Produce', 1), ('echo-park-co-op', 'Pantry', 2)
) as v(slug, name, sort)
join merchants m on m.slug = v.slug
on conflict (merchant_id, name) do nothing;

insert into items (merchant_id, category_id, name, description, price_cents, unit, tags, dietary, freshness_note, is_commodity, sort)
select m.id,
       (select id from menu_categories mc where mc.merchant_id = m.id and mc.name = v.cat),
       v.name, v.descr, v.price, v.unit, v.tags::text[], v.diet::text[], v.fresh, v.commodity, v.sort
from (values
  -- Tacos El Gallo
  ('tacos-el-gallo','Tacos','Al Pastor Taco','Spit-roasted pork, pineapple, handmade corn tortilla.',349,'each','{popular,spicy}','{}','Trompo fired at 11am',false,1),
  ('tacos-el-gallo','Tacos','Carne Asada Taco','Grilled skirt steak, onion, cilantro, salsa verde.',399,'each','{popular}','{}',null,false,2),
  ('tacos-el-gallo','Tacos','Birria Taco','Slow-braised beef, griddled tortilla, consomme dip.',425,'each','{popular}','{}',null,false,3),
  ('tacos-el-gallo','Tacos','Bean and Cheese Burrito','Pinto beans, jack cheese, salsa roja.',699,'each','{}','{vegetarian}','{}'::text,false,4),
  ('tacos-el-gallo','Sides','Chips and Guacamole','Made to order, serrano kick.',549,'basket','{}','{vegan,vegetarian}','{}'::text,false,5),
  ('tacos-el-gallo','Drinks','Horchata','Rice, cinnamon, whole milk, over ice.',349,'16oz','{}','{vegetarian}','{}'::text,false,6),
  -- Echo Park Bakery
  ('echo-park-bakery','Bakery','Concha','Vanilla or chocolate shell, baked every morning.',250,'each','{popular}','{vegetarian}','Out of the oven 6:30am',false,1),
  ('echo-park-bakery','Bakery','Country Sourdough Loaf','48-hour ferment, blistered crust.',750,'loaf','{}','{vegan,vegetarian}','Pulled from the oven 7am',false,2),
  ('echo-park-bakery','Bakery','Butter Croissant','Laminated, 72 layers, baked at dawn.',400,'each','{}','{vegetarian}',null,false,3),
  ('echo-park-bakery','Bakery','Guava Turnover','Flaky, guava paste, dusted sugar.',375,'each','{}','{vegetarian}',null,false,4),
  ('echo-park-bakery','Coffee','Drip Coffee','Single origin house roast.',300,'12oz','{}','{vegan,vegetarian}',null,false,5),
  -- La Bodega Verde
  ('la-bodega-verde','Cold Case','Mangoes, Just In','Ataulfo mangoes by the crate.',1200,'crate','{popular}','{vegan,vegetarian}','Mangoes just in from the truck',true,1),
  ('la-bodega-verde','Cold Case','Agua Fresca','Watermelon or hibiscus, made this morning.',350,'24oz','{}','{vegan,vegetarian}',null,false,2),
  ('la-bodega-verde','Pantry','Corn Tortillas, 30 pack','Warm from the comal next door.',450,'pack','{}','{vegan,vegetarian}',null,false,3),
  ('la-bodega-verde','Pantry','Eggs, Dozen','Pasture-raised, local farm.',599,'dozen','{}','{vegetarian}',null,false,4),
  ('la-bodega-verde','Pantry','Ice, 10 lb Bag','Crushed or cubed.',399,'bag','{}','{}'::text,null,false,5),
  -- Sunset Produce Stand
  ('sunset-produce-stand','Produce','Strawberries','Sweet, picked at 5am in Oxnard.',549,'1 lb','{popular}','{vegan,vegetarian}','Picked this morning',false,1),
  ('sunset-produce-stand','Produce','Hass Avocados','Ripe and ready today.',150,'each','{}','{vegan,vegetarian}',null,false,2),
  ('sunset-produce-stand','Produce','Heirloom Tomatoes','Cherokee purple, ugly and delicious.',649,'lb','{}','{vegan,vegetarian}','Cut this morning',false,3),
  ('sunset-produce-stand','Produce','Spring Salad Mix','Cut this morning, washed twice.',399,'bag','{}','{vegan,vegetarian}',null,false,4),
  ('sunset-produce-stand','Produce','Citrus Mix Bag','Mandarins, lemons, limes.',699,'5 lb bag','{}','{vegan,vegetarian}',null,true,5),
  -- Carniceria Ramirez
  ('carniceria-ramirez','Marinated','Carne Asada, Marinated','Rancho-style, ready for the grill.',1299,'lb','{popular}','{}',null,false,1),
  ('carniceria-ramirez','Marinated','House Chorizo','House ground, mild heat.',899,'lb','{}','{}'::text,null,false,2),
  ('carniceria-ramirez','Meat','Whole Chicken','Air-chilled, local farm.',1099,'each','{}','{}'::text,null,false,3),
  ('carniceria-ramirez','Meat','Carnitas','Slow-fried, by the pound.',1199,'lb','{popular}','{}'::text,null,false,4),
  ('carniceria-ramirez','Meat','Marinated Shrimp','Garlic-lime, cleaned and deveined.',1499,'lb','{}','{}'::text,null,false,5),
  -- Cafe Alameda
  ('cafe-alameda','Coffee','Cortado','Two shots, steamed milk, 4oz.',425,'4oz','{}','{vegetarian}',null,false,1),
  ('cafe-alameda','Coffee','Cold Brew','18-hour steep, on tap.',500,'16oz','{popular}','{vegan,vegetarian}',null,false,2),
  ('cafe-alameda','Coffee','Horchata Latte','House horchata with espresso.',575,'12oz','{}','{vegetarian}',null,false,3),
  ('cafe-alameda','Pastries','Concha Toast','Toasted concha, cinnamon butter.',650,'plate','{}','{vegetarian}',null,false,4),
  ('cafe-alameda','Pastries','Iced Matcha','Ceremonial grade, oat milk.',550,'12oz','{}','{vegan,vegetarian}',null,false,5),
  -- Bulk & Barrel
  ('bulk-and-barrel','Bulk','Rolled Oats','Organic, by the pound.',249,'lb','{}','{vegan,vegetarian}',null,true,1),
  ('bulk-and-barrel','Bulk','Raw Almonds','California grown, by the pound.',999,'lb','{}','{vegan,vegetarian}',null,true,2),
  ('bulk-and-barrel','Bulk','Brown Rice','Organic long grain.',299,'lb','{}','{vegan,vegetarian}',null,true,3),
  ('bulk-and-barrel','Pantry','Olive Oil Refill','Bring your own bottle.',1299,'liter','{}','{vegan,vegetarian}',null,false,4),
  ('bulk-and-barrel','Pantry','Local Honey','Wildflower, Echo Park hives.',1150,'12oz','{}','{vegetarian}',null,false,5),
  -- Flores de Echo
  ('flores-de-echo','Bouquets','Seasonal Bouquet','Arranged this morning.',1800,'bouquet','{popular}','{}'::text,'Arranged this morning',false,1),
  ('flores-de-echo','Bouquets','Dozen Roses','Red or blush, wrapped in kraft.',2400,'dozen','{}','{}'::text,null,false,2),
  ('flores-de-echo','Bouquets','Sunflower Bunch','Five stems, tall.',1200,'bunch','{}','{}'::text,null,false,3),
  ('flores-de-echo','Plants','Small Succulent','In terracotta pot.',900,'each','{}','{}'::text,null,false,4),
  -- Halal Corner
  ('halal-corner','Plates','Chicken Over Rice','White sauce, hot sauce, salad.',1199,'plate','{popular}','{}'::text,null,false,1),
  ('halal-corner','Plates','Lamb Gyro','Shaved to order, warm pita.',1299,'each','{}','{}'::text,null,false,2),
  ('halal-corner','Plates','Falafel Wrap','Crispy falafel, tahini, pickles.',999,'each','{}','{vegan,vegetarian}',null,false,3),
  ('halal-corner','Sweets','Baklava','Pistachio and honey, two pieces.',450,'piece','{}','{vegetarian}',null,false,4),
  -- Verde Vegan Kitchen
  ('verde-vegan-kitchen','Bowls','Jackfruit Barbacoa Bowl','Slow-cooked jackfruit, black beans, rice.',1399,'bowl','{popular}','{vegan,vegetarian}',null,false,1),
  ('verde-vegan-kitchen','Snacks','Cashew Queso and Chips','Smoked cashew queso, salsa verde.',899,'basket','{}','{vegan,vegetarian}',null,false,2),
  ('verde-vegan-kitchen','Bowls','Kale Caesar','Cashew dressing, crispy capers.',1150,'bowl','{}','{vegan,vegetarian}',null,false,3),
  ('verde-vegan-kitchen','Snacks','Mushroom Torta','King oyster, avocado, chipotle aioli.',1350,'each','{}','{vegan,vegetarian}',null,false,4),
  ('verde-vegan-kitchen','Snacks','Agua de Jamaica','House brewed, lightly sweet.',400,'16oz','{}','{vegan,vegetarian}',null,false,5),
  -- Panaderia La Espiga
  ('panaderia-la-espiga','Bread','Bolillo','Baked every two hours.',150,'each','{}','{vegetarian}','Fresh tray at 7am',false,1),
  ('panaderia-la-espiga','Bread','Telera Rolls, 6 pack','For tortas, soft crumb.',550,'pack','{}','{vegetarian}',null,false,2),
  ('panaderia-la-espiga','Pan Dulce','Pink Concha','Strawberry shell, soft center.',260,'each','{}','{vegetarian}',null,false,3),
  ('panaderia-la-espiga','Pan Dulce','Pumpkin Empanada','Seasonal filling, cinnamon sugar.',320,'each','{}','{vegetarian}',null,false,4),
  ('panaderia-la-espiga','Pan Dulce','Tres Leches Slice','Soaked overnight, whipped cream.',550,'slice','{popular}','{vegetarian}',null,false,5),
  -- Mariscos El Pescador
  ('mariscos-el-pescador','Mariscos','Ceviche Tostada','Snapper, lime, avocado, crisp tostada.',899,'each','{popular}','{}'::text,null,false,1),
  ('mariscos-el-pescador','Mariscos','Shrimp Cocktail','Served cold in a big glass.',1299,'each','{}','{}'::text,null,false,2),
  ('mariscos-el-pescador','Mariscos','Baja Fish Tacos, 3','Beer-battered, cabbage slaw.',1350,'order','{}','{}'::text,null,false,3),
  ('mariscos-el-pescador','Market','Oysters, Half Dozen','Kumamoto, shucked to order.',1800,'half dozen','{}','{}'::text,'Shucked to order',false,4),
  ('mariscos-el-pescador','Market','Whole Red Snapper','Cleaned, on ice.',1699,'each','{}','{}'::text,null,true,5),
  -- Corner Mart 24
  ('corner-mart-24','Essentials','Water, 1 Gallon','Spring water, chilled.',299,'gallon','{}','{}'::text,null,false,1),
  ('corner-mart-24','Snacks','Chips, Large Bag','Classic, flamin hot, or lime.',449,'bag','{}','{vegetarian}',null,false,2),
  ('corner-mart-24','Snacks','Energy Drink','Cold, 16oz.',379,'can','{}','{vegetarian}',null,false,3),
  ('corner-mart-24','Snacks','Turkey Sandwich','Made today, on a bolillo.',799,'each','{}','{}'::text,null,false,4),
  ('corner-mart-24','Essentials','Phone Charger Cable','USB-C or lightning.',1299,'each','{}','{}'::text,null,false,5),
  -- Taqueria La Palma
  ('taqueria-la-palma','Tacos','Suadero Taco','Confit beef, salsa verde, onion.',375,'each','{popular}','{}'::text,null,false,1),
  ('taqueria-la-palma','Tacos','Cabeza Taco','Slow-braised, cilantro and onion.',375,'each','{}','{}'::text,null,false,2),
  ('taqueria-la-palma','Tacos','Quesadilla','Griddled, Oaxaca cheese.',899,'each','{}','{vegetarian}',null,false,3),
  ('taqueria-la-palma','Tacos','Mulita','Two tortillas, melted cheese, meat.',950,'each','{popular}','{}'::text,null,false,4),
  ('taqueria-la-palma','Drinks','Consome','Birria broth, 12oz cup.',450,'cup','{}','{}'::text,null,false,5),
  ('taqueria-la-palma','Drinks','Champurrado','Thick chocolate atole.',400,'cup','{}','{vegetarian}',null,false,6),
  -- Echo Park Co-op
  ('echo-park-co-op','Produce','Weekly Produce Box','Curated by members, about 10 lb.',3200,'box','{popular}','{vegan,vegetarian}',null,true,1),
  ('echo-park-co-op','Pantry','Co-op Sourdough','Member-baked, dense crumb.',800,'loaf','{}','{vegan,vegetarian}','Baked this morning',false,2),
  ('echo-park-co-op','Pantry','Kombucha Refill','Bring your growler, 32oz.',900,'32oz','{}','{vegan,vegetarian}',null,false,3),
  ('echo-park-co-op','Pantry','Tofu Block','Organic, firm, 14oz.',399,'block','{}','{vegan,vegetarian}',null,false,4)
) as v(slug, cat, name, descr, price, unit, tags, diet, fresh, commodity, sort)
join merchants m on m.slug = v.slug
on conflict (merchant_id, name) do nothing;

-- Item options (group_name/name is the natural key)
insert into item_options (item_id, name, price_delta_cents, group_name, required, sort)
select i.id, v.name, v.delta, v.grp, v.req, v.sort
from (values
  ('tacos-el-gallo','Al Pastor Taco','Corn tortilla',0,'Tortilla',true,1),
  ('tacos-el-gallo','Al Pastor Taco','Flour tortilla',0,'Tortilla',true,2),
  ('tacos-el-gallo','Al Pastor Taco','Extra salsa roja',0,'Add-ons',false,3),
  ('tacos-el-gallo','Al Pastor Taco','Avocado',150,'Add-ons',false,4),
  ('cafe-alameda','Cortado','Whole milk',0,'Milk',true,1),
  ('cafe-alameda','Cortado','Oat milk',50,'Milk',true,2),
  ('cafe-alameda','Cortado','Almond milk',50,'Milk',true,3),
  ('cafe-alameda','Cold Brew','16oz',0,'Size',true,1),
  ('cafe-alameda','Cold Brew','24oz',125,'Size',true,2),
  ('verde-vegan-kitchen','Jackfruit Barbacoa Bowl','Extra avocado',200,'Add-on',false,1),
  ('verde-vegan-kitchen','Jackfruit Barbacoa Bowl','Cashew queso',300,'Add-on',false,2),
  ('taqueria-la-palma','Mulita','Extra cheese',150,'Add-on',false,1)
) as v(slug, item, name, delta, grp, req, sort)
join merchants m on m.slug = v.slug
join items i on i.merchant_id = m.id and i.name = v.item
on conflict (item_id, group_name, name) do nothing;

-- ---------------------------------------------------------------- drops & deals
insert into drops (merchant_id, item_id, title, qty_total, qty_left, price_cents, starts_at, ends_at)
select m.id, i.id, v.title, v.qty, v.qty, v.price, now() - interval '1 hour', now() + interval '6 hours'
from (values
  ('tacos-el-gallo','Al Pastor Taco','Al pastor out of the trompo, 20 left',20,300),
  ('echo-park-bakery','Concha','Concha tray just out of the oven',12,225)
) as v(slug, item, title, qty, price)
join merchants m on m.slug = v.slug
join items i on i.merchant_id = m.id and i.name = v.item
on conflict (merchant_id, title) do update
  set starts_at = now() - interval '1 hour',
      ends_at = now() + interval '6 hours';

insert into deals (merchant_id, title, type, value, starts_at, ends_at, active)
select m.id, v.title, v.type::deal_type, v.value, now() - interval '1 hour', now() + interval '8 hours', true
from (values
  ('verde-vegan-kitchen','20 percent off bowls until 8pm','percent',20),
  ('mariscos-el-pescador','3 dollars off ceviche tostadas','fixed',300),
  ('cafe-alameda','Buy one get one cortado','bogo',1)
) as v(slug, title, type, value)
join merchants m on m.slug = v.slug
on conflict (merchant_id, title) do update
  set starts_at = now() - interval '1 hour', ends_at = now() + interval '8 hours', active = true;

-- ---------------------------------------------------------------- speed dial
insert into favorites (user_id, merchant_id, speed_dial_slot)
select p.id, m.id, v.slot
from (values
  ('tacos-el-gallo', 1), ('cafe-alameda', 2), ('echo-park-bakery', 3)
) as v(slug, slot)
join merchants m on m.slug = v.slug
cross join (select id from profiles where email = 'neighbor@localloop.dev') p
on conflict (user_id, merchant_id) do nothing;

-- ---------------------------------------------------------------- reviews
do $$
declare
  m record;
  reviewer record;
  bodies text[] := array[
    'Walked over on my lunch break, everything was ready and hot.',
    'Solid neighborhood spot. Prices are fair and they know their regulars.',
    'Came in on a whim and left with way too much food. No regrets.',
    'Fresh and fast. This is why I stopped ordering from the big apps.',
    'Good, not great today. They were slammed at noon.',
    'My weekly stop, consistent every single time.'
  ];
  seed int;
begin
  for m in select id, slug from merchants where status = 'live' order by slug loop
    for reviewer in
      select p.id, row_number() over (order by p.email) as rn
      from profiles p
      where p.email in ('neighbor@localloop.dev', 'marisol@localloop.dev', 'teo@localloop.dev')
    loop
      seed := abs(hashtext(m.slug || reviewer.rn::text));
      insert into reviews (user_id, merchant_id, rating, body, created_at)
      select reviewer.id, m.id,
             3 + (seed % 3),
             bodies[1 + (seed % array_length(bodies, 1))],
             now() - (seed % 45) * interval '1 day'
      where not exists (
        select 1 from reviews r where r.merchant_id = m.id and r.user_id = reviewer.id
      );
    end loop;
  end loop;
end $$;

update merchants m
set rating_avg = coalesce((select round(avg(r.rating)::numeric, 1) from reviews r where r.merchant_id = m.id), 0);

-- ---------------------------------------------------------------- order history (for Orders, reorder, analytics, Loop Points)
insert into orders (code, user_id, merchant_id, status, fulfillment, subtotal_cents, platform_fee_cents,
                    service_fee_cents, tip_cents, total_cents, payment_status, stripe_payment_intent,
                    pickup_slot, created_at, updated_at)
select v.code, u.id, m.id, v.status::order_status, 'pickup', v.subtotal, v.platform, 99, v.tip,
       v.subtotal + 99 + v.tip, v.pay, 'sim_seed_' || v.code,
       now() - (v.days || ' days')::interval,
       now() - (v.days || ' days')::interval,
       now() - (v.days || ' days')::interval
from (values
  ('LL-1001', 'tacos-el-gallo', 'picked_up', 1596, 80, 200, 'paid', 2),
  ('LL-1002', 'cafe-alameda', 'picked_up', 1075, 54, 0, 'paid', 5),
  ('LL-1003', 'sunset-produce-stand', 'cancelled', 1548, 77, 0, 'refunded', 9)
) as v(code, slug, status, subtotal, platform, tip, pay, days)
join merchants m on m.slug = v.slug
cross join (select id from profiles where email = 'neighbor@localloop.dev') u
where not exists (select 1 from orders o where o.code = v.code);

insert into order_items (order_id, item_id, name_snapshot, price_snapshot, qty)
select o.id, i.id, i.name, v.price, v.qty
from (values
  ('LL-1001', 'tacos-el-gallo', 'Al Pastor Taco', 349, 2),
  ('LL-1001', 'tacos-el-gallo', 'Chips and Guacamole', 549, 1),
  ('LL-1001', 'tacos-el-gallo', 'Horchata', 349, 1),
  ('LL-1002', 'cafe-alameda', 'Cortado', 425, 1),
  ('LL-1002', 'cafe-alameda', 'Concha Toast', 650, 1),
  ('LL-1003', 'sunset-produce-stand', 'Strawberries', 549, 2),
  ('LL-1003', 'sunset-produce-stand', 'Hass Avocados', 150, 3)
) as v(code, slug, item, price, qty)
join orders o on o.code = v.code
join merchants m on m.slug = v.slug
join items i on i.merchant_id = m.id and i.name = v.item
where not exists (select 1 from order_items oi where oi.order_id = o.id);

update orders set refunded_at = updated_at, cancel_reason = 'stand closed early'
  where code = 'LL-1003' and refunded_at is null;

insert into loop_points (user_id, merchant_id, points, reason, order_id)
select o.user_id, o.merchant_id, floor(o.subtotal_cents / 100.0)::int, 'order_' || o.code, o.id
from orders o
where o.code in ('LL-1001', 'LL-1002')
  and not exists (select 1 from loop_points lp where lp.order_id = o.id);

insert into notifications (user_id, type, title, payload, read_at)
select p.id, v.type, v.title, v.payload::jsonb, v.read
from (values
  ('order_status', 'Order LL-1001 was picked up', '{"order_code":"LL-1001"}', now() - interval '2 days'),
  ('drop', 'Tacos El Gallo posted a drop: 20 al pastor left', '{"slug":"tacos-el-gallo"}', null)
) as v(type, title, payload, read)
cross join (select id from profiles where email = 'neighbor@localloop.dev') p
where not exists (select 1 from notifications n where n.user_id = p.id and n.title = v.title);
