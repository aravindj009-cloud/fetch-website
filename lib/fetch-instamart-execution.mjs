import { buildInstamartCartPreview, updateCart, getCart, getPaymentOptions, checkout, trackOrder } from "./swiggy-instamart-mcp.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function normalizeInstamartName(product, variant, requested) {
  return firstText(
    variant?.displayName,
    variant?.productName,
    variant?.title,
    variant?.itemName,
    product?.displayName,
    product?.productName,
    product?.title,
    product?.itemName,
    product?.name,
    requested
  );
}

function normalizeInstamartPack(product, variant) {
  return firstText(
    variant?.packSize,
    variant?.pack_size,
    variant?.size,
    variant?.weight,
    variant?.volume,
    variant?.quantityText,
    product?.packSize,
    product?.pack_size,
    product?.size,
    product?.weight,
    product?.volume,
    variant?.quantity
  );
}

function productOptionKey(option) {
  return [
    option.spinId || "",
    option.skuId || "",
    option.name || "",
    option.pack || "",
    option.price ?? ""
  ].join("|").toLowerCase();
}

function normalizeInstamartPrice(value) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string") return value;

  if (typeof value === "object") {
    const candidate =
      value.offerPrice ??
      value.levelPrice ??
      value.sellingPrice ??
      value.salePrice ??
      value.mrp ??
      value.price ??
      null;

    if (candidate != null && (typeof candidate === "number" || typeof candidate === "string")) {
      return candidate;
    }

    // Some provider payloads wrap the actual price one level deeper.
    if (candidate && typeof candidate === "object") {
      return normalizeInstamartPrice(candidate);
    }
  }

  return null;
}

function extractInstamartSearchData(toolResult) {
  const queue = [toolResult];
  const seen = new Set();
  let fallback = {};

  while (queue.length) {
    const current = queue.shift();

    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    // Do not stop on an empty wrapper such as products: [].
    // Swiggy MCP can expose the populated payload deeper inside
    // structuredContent/data/content.
    if (
      (Array.isArray(current.products) && current.products.length > 0) ||
      (Array.isArray(current.similarProducts) && current.similarProducts.length > 0)
    ) {
      return current;
    }

    if (
      Array.isArray(current.products) ||
      Array.isArray(current.similarProducts)
    ) {
      fallback = current;
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object" && !seen.has(value)) {
        queue.push(value);
      }
    }

    if (Array.isArray(current?.content)) {
      for (const part of current.content) {
        if (part?.type === "text" && typeof part.text === "string") {
          try { queue.push(JSON.parse(part.text)); } catch {}
        }
      }
    }
  }

  return fallback;
}

export async function prepareInstamartOrder({
  accessToken,
  items,
  addressId
} = {}) {
  if (!clean(accessToken)) {
    return {
      success: false,
      status: "connection_required",
      message: "Connect Swiggy Instamart to Fetch before placing an order."
    };
  }

  const preview = await buildInstamartCartPreview({
    accessToken,
    items,
    addressId
  });

  if (!preview.success) {
    return {
      ...preview,
      stage: preview.stage || "provider"
    };
  }

  if (preview.status === "address_selection_required") {
    return {
      success: true,
      status: "address_selection_required",
      provider: "swiggy_instamart",
      addresses: preview.addresses || [],
      requestedItems: items || [],
      message: "I found your Instamart connection. Which saved delivery address should I use?"
    };
  }

  /*
   * Product selection is deliberately not automated blindly.
   * Search results can contain variants, pack sizes and substitutions.
   * The next UI step will let the user choose/approve the exact products.
   */
  const productOptions = preview.searches.flatMap((search) => {
    const data = extractInstamartSearchData(search?.result);
    const products = [
      ...(Array.isArray(data?.products) ? data.products : []),
      ...(Array.isArray(data?.similarProducts) ? data.similarProducts : [])
    ];

    return products.flatMap((product) => {
      const variants =
        Array.isArray(product?.variants) ? product.variants :
        Array.isArray(product?.variations) ? product.variations :
        Array.isArray(product?.variant) ? product.variant :
        [];

      // Be tolerant if the provider flattens SKU fields onto the product.
      const normalizedVariants = variants.length
        ? variants
        : (
            product?.spinId ||
            product?.spin_id ||
            product?.skuId ||
            product?.sku_id ||
            product?.id
          )
          ? [product]
          : [];

      return normalizedVariants.map((variant) => ({
        requested: search.requested,
        quantity: search.quantity,
        requestedQuantity: search.quantity,
        requestedUnit: search.unit || null,
        name: normalizeInstamartName(product, variant, search.requested),
        imageUrl: firstText(variant?.imageUrl, variant?.image_url, product?.imageUrl, product?.image_url) || null,
        price: normalizeInstamartPrice(variant?.price ?? variant?.sellingPrice ?? product?.price ?? null),
        pack: normalizeInstamartPack(product, variant),
        spinId: variant?.spinId || variant?.spin_id || variant?.id || product?.spinId || product?.spin_id || null,
        skuId: variant?.skuId || variant?.sku_id || product?.skuId || product?.sku_id || null,
        inStock: variant?.inStock ?? variant?.in_stock ?? product?.inStock ?? product?.in_stock ?? null
      })).filter((item) => item.spinId);
    });
  });

  const uniqueProductOptions = Array.from(
    new Map(productOptions.map((option) => [productOptionKey(option), option])).values()
  )
    .slice(0, 8)
    .map((option) => ({
      ...option,
      quantity: computeCartQuantity(option)
    }));

  return {
    success: true,
    status: "awaiting_product_selection",
    provider: "swiggy_instamart",
    address: preview.address,
    addressId: preview.addressId,
    searches: preview.searches,
    requestedItems: items || [],
    productOptions: uniqueProductOptions,
    message: uniqueProductOptions.length
      ? "I found the live Instamart matches. Review the products and choose the variants you want."
      : "Instamart returned no usable live product matches for that request. Try a more specific product or another search term.",
    diagnostics: uniqueProductOptions.length
      ? undefined
      : {
          searchedItems: preview.searches.map((search) => search.requested),
          searchStatuses: preview.searches.map((search) => search.result?.status || "unknown")
        }
  };
}

function parsePackQuantity(pack) {
  const text = clean(pack).toLowerCase();
  const match = text.match(/(\\d+(?:\\.\\d+)?)\\s*(kg|kgs|g|gram|grams|l|ltr|litre|litres|ml)\\b/i);
  if (!match) return null;
  return {
    value: Number(match[1]),
    unit: match[2].toLowerCase()
  };
}

function computeCartQuantity(option) {
  const requestedQuantity = Math.max(1, Number(option?.requestedQuantity || option?.quantity || 1));
  const requestedUnit = clean(option?.requestedUnit).toLowerCase();
  const pack = parsePackQuantity(option?.pack);

  if (!pack || !requestedUnit) return requestedQuantity;

  const normalizeUnit = (unit, value) => {
    const u = String(unit).toLowerCase();
    if (u === "kg" || u === "kgs" || u === "kilogram" || u === "kilograms") return value * 1000;
    if (u === "g" || u === "gram" || u === "grams") return value;
    if (u === "l" || u === "ltr" || u === "litre" || u === "litres") return value * 1000;
    if (u === "ml" || u === "milliliter" || u === "millilitre") return value;
    return null;
  };

  const requestedBase = normalizeUnit(requestedUnit, requestedQuantity);
  const packBase = normalizeUnit(pack.unit, pack.value);

  if (!requestedBase || !packBase || packBase <= 0) return requestedQuantity;

  const exact = requestedBase / packBase;
  return Number.isInteger(exact) && exact > 0 ? exact : requestedQuantity;
}

function extractCartLineItems(cart) {
  const root = cart?.data?.data || cart?.data || cart || {};
  const found = [];
  const seen = new Set();

  function walk(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) return;
    seen.add(value);

    for (const key of ["items", "cartItems", "lineItems", "products"]) {
      if (Array.isArray(value[key])) {
        for (const item of value[key]) {
          if (item && typeof item === "object") found.push(item);
        }
      }
    }

    for (const valuePart of Object.values(value)) {
      if (valuePart && typeof valuePart === "object") walk(valuePart, depth + 1);
    }
  }

  walk(root);
  return Array.from(new Set(found));
}

function verifyInstamartCartSelection(cart, selectedItems) {
  const lines = extractCartLineItems(cart);
  if (!lines.length) {
    return {
      ok: false,
      reason: "Instamart returned an empty cart after the selection."
    };
  }

  const normalizedSelected = selectedItems.map((item) => ({
    id: clean(item?.spinId),
    quantity: Math.max(1, Number(item?.quantity || 1))
  }));

  const mismatches = [];
  for (const selected of normalizedSelected) {
    const line = lines.find((item) => {
      const ids = [
        item?.spinId, item?.spin_id, item?.skuId, item?.sku_id,
        item?.itemId, item?.item_id, item?.id
      ].map(clean).filter(Boolean);
      return selected.id && ids.includes(selected.id);
    });

    if (!line) {
      mismatches.push({ spinId: selected.id, expectedQuantity: selected.quantity, reason: "selected SKU not present in live cart" });
      continue;
    }

    const actualQuantity = Number(line?.quantity ?? line?.qty ?? line?.count ?? 1);
    if (Number.isFinite(actualQuantity) && actualQuantity !== selected.quantity) {
      mismatches.push({
        spinId: selected.id,
        expectedQuantity: selected.quantity,
        actualQuantity,
        reason: "quantity mismatch"
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches
  };
}

export async function applyInstamartSelection({
  accessToken,
  addressId,
  items
} = {}) {
  const safeItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      spinId: clean(item?.spinId),
      quantity: Math.max(1, Number(item?.quantity || 1))
    }))
    .filter((item) => item.spinId);

  if (!safeItems.length) {
    return {
      success: false,
      status: "selection_required",
      message: "No valid Instamart product selection was provided."
    };
  }

  const cart = await updateCart({
    accessToken,
    addressId,
    items: safeItems
  });

  if (!cart.success) return cart;

  const liveCart = await getCart({ accessToken });

  if (!liveCart.success) return liveCart;

  const verification = verifyInstamartCartSelection(liveCart, safeItems);
  if (!verification.ok) {
    return {
      success: false,
      status: "cart_verification_failed",
      provider: "swiggy_instamart",
      addressId,
      cart: liveCart.data,
      verification,
      message: "I stopped before payment because the live Instamart cart does not exactly match the product selection. No order was placed."
    };
  }

  const paymentOptions = await getPaymentOptions(accessToken);

  return {
    success: true,
    status: "awaiting_checkout_confirmation",
    provider: "swiggy_instamart",
    addressId,
    cart: liveCart.data,
    paymentOptions: paymentOptions.success ? paymentOptions.data : null,
    message: "Your live Instamart cart is ready. Review the total and choose a payment method before I place it."
  };
}

export async function confirmInstamartCheckout({
  accessToken,
  addressId,
  paymentMethod,
  intentApp,
  generateUPIQR,
  confirmed
} = {}) {
  if (confirmed !== true) {
    return {
      success: false,
      status: "confirmation_required",
      message: "Customer confirmation is required before checkout."
    };
  }

  const result = await checkout({
    accessToken,
    addressId,
    paymentMethod,
    intentApp,
    generateUPIQR
  });

  if (!result.success) return result;

  const resultData = result?.data || {};
  const providerStatus = String(resultData?.status || "").toUpperCase();

  if (providerStatus === "PENDING_PAYMENT") {
    return {
      ...result,
      provider: "swiggy_instamart",
      status: "awaiting_payment",
      payment: resultData,
      message: result?.message || "Your order is ready for payment. Complete the payment to finish the order."
    };
  }

  return {
    ...result,
    provider: "swiggy_instamart",
    status: "order_placed",
    orderId: resultData?.orderId || result?.orderId || null
  };
}


export async function trackInstamartOrder({
  accessToken,
  orderId
} = {}) {
  return trackOrder({
    accessToken,
    orderId
  });
}
