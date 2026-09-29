import { uberRequest } from "./uber-oauth.mjs";

const clean = (v) => String(v ?? "").trim();

export async function geocodePlace(query) {
  const q = clean(query);
  if (!q) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "in");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Fetch personal assistant (https://tryfetch.in)"
    }
  });

  if (!response.ok) {
    throw new Error("Could not resolve the destination right now.");
  }

  const results = await response.json();
  const place = Array.isArray(results) ? results[0] : null;
  if (!place) return null;

  return {
    label: clean(place.display_name),
    latitude: Number(place.lat),
    longitude: Number(place.lon)
  };
}

function validCoordinate(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max;
}

export async function prepareUberRide({
  accessToken,
  pickupLatitude,
  pickupLongitude,
  destination
} = {}) {
  if (!accessToken) {
    return { success: false, status: "connection_required", message: "Connect Uber to Fetch first." };
  }

  if (
    !validCoordinate(pickupLatitude, -90, 90) ||
    !validCoordinate(pickupLongitude, -180, 180)
  ) {
    return {
      success: false,
      status: "awaiting_location",
      message: "I need your pickup location before I can work out the ride."
    };
  }

  const destinationPlace = await geocodePlace(destination);
  if (!destinationPlace) {
    return {
      success: false,
      status: "needs_clarification",
      message: "I couldn't find that destination. Give me the place name or address and I'll try again."
    };
  }

  const products = await uberRequest({
    accessToken,
    path: `/products?latitude=${encodeURIComponent(pickupLatitude)}&longitude=${encodeURIComponent(pickupLongitude)}`
  });

  const availableProducts = Array.isArray(products?.products)
    ? products.products
    : [];

  const product =
    availableProducts.find((item) => item?.upfront_fare_enabled) ||
    availableProducts[0] ||
    null;

  if (!product?.product_id) {
    return {
      success: false,
      status: "no_ride_option",
      message: "Uber didn't return a ride option for your pickup location."
    };
  }

  const estimate = await uberRequest({
    accessToken,
    path: "/requests/estimate",
    method: "POST",
    body: {
      product_id: product.product_id,
      start_latitude: Number(pickupLatitude),
      start_longitude: Number(pickupLongitude),
      end_latitude: destinationPlace.latitude,
      end_longitude: destinationPlace.longitude,
      seat_count: 1
    }
  });

  return {
    success: true,
    status: "awaiting_ride_confirmation",
    provider: "uber",
    pickup: {
      latitude: Number(pickupLatitude),
      longitude: Number(pickupLongitude),
      label: "Current location"
    },
    destination: destinationPlace,
    product: {
      product_id: product.product_id,
      display_name: product.display_name || product.short_name || "Uber",
      description: product.description || "",
      capacity: product.capacity || null
    },
    fare: estimate?.fare || null,
    trip: estimate?.trip || null,
    pickup_estimate: estimate?.pickup_estimate ?? null,
    prepared_at: new Date().toISOString(),
    side_effect: false,
    confirmation_required: true
  };
}

export async function requestUberRide({ accessToken, preview } = {}) {
  if (!accessToken) throw new Error("Connect Uber to Fetch first.");
  if (!preview?.product?.product_id) {
    throw new Error("The Uber ride option is no longer available. Please request a fresh estimate.");
  }

  const estimate = await uberRequest({
    accessToken,
    path: "/requests/estimate",
    method: "POST",
    body: {
      product_id: preview.product.product_id,
      start_latitude: Number(preview.pickup.latitude),
      start_longitude: Number(preview.pickup.longitude),
      end_latitude: Number(preview.destination.latitude),
      end_longitude: Number(preview.destination.longitude),
      seat_count: 1
    }
  });

  const request = await uberRequest({
    accessToken,
    path: "/requests",
    method: "POST",
    body: {
      product_id: preview.product.product_id,
      start_latitude: Number(preview.pickup.latitude),
      start_longitude: Number(preview.pickup.longitude),
      end_latitude: Number(preview.destination.latitude),
      end_longitude: Number(preview.destination.longitude),
      seat_count: 1,
      fare_id: estimate?.fare?.fare_id
    }
  });

  return {
    success: true,
    status: request?.status || "processing",
    request_id: request?.request_id || null,
    product: preview.product,
    pickup: preview.pickup,
    destination: preview.destination,
    fare: estimate?.fare || preview.fare || null,
    trip: estimate?.trip || preview.trip || null,
    data: request,
    side_effect: true,
    confirmation_required: false
  };
}

export async function getUberRide(accessToken, requestId) {
  return uberRequest({
    accessToken,
    path: requestId ? `/requests/${encodeURIComponent(requestId)}` : "/requests/current"
  });
}
