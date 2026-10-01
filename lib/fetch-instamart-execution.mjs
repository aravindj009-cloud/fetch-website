import { buildInstamartCartPreview, updateCart, getCart, getPaymentOptions, checkout, trackOrder } from "./swiggy-instamart-mcp.mjs";

function clean(value) {
  return String(value ?? "").trim();
}

function extractInstamartSearchData(toolResult) {
  const queue = [toolResult];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();

    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current.products)) return current;

    for (const key of ["structuredContent", "data", "result", "output"]) {
      const nested = current?.[key];
      if (nested && nested !== current) queue.push(nested);
    }

    if (Array.isArray(current?.content)) {
      for (const part of current.content) {
        if (part?.type === "text" && typeof part.text === "string") {
          try { queue.push(JSON.parse(part.text)); } catch {}
        } else if (part && typeof part === "object") {
          queue.push(part);
        }
      }
    }
  }

  return {};
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
        name: product?.name || variant?.name || search.requested,
        imageUrl: product?.imageUrl || variant?.imageUrl || null,
        price: variant?.price ?? variant?.sellingPrice ?? product?.price ?? null,
        pack: variant?.packSize || variant?.pack_size || variant?.name || variant?.quantity || "",
        spinId: variant?.spinId || variant?.spin_id || variant?.id || product?.spinId || product?.spin_id || null,
        skuId: variant?.skuId || variant?.sku_id || product?.skuId || product?.sku_id || null,
        inStock: variant?.inStock ?? variant?.in_stock ?? product?.inStock ?? product?.in_stock ?? null
      })).filter((item) => item.spinId);
    });
  });

  return {
    success: true,
    status: "awaiting_product_selection",
    provider: "swiggy_instamart",
    address: preview.address,
    addressId: preview.addressId,
    searches: preview.searches,
    requestedItems: items || [],
    productOptions,
    message: productOptions.length
      ? "I found the live Instamart matches. Review the products and choose the variants you want."
      : "Instamart returned no usable live product matches for that request. Try a more specific product or another search term.",
    diagnostics: productOptions.length
      ? undefined
      : {
          searchedItems: preview.searches.map((search) => search.requested),
          searchStatuses: preview.searches.map((search) => search.result?.status || "unknown")
        }
  };
}

export async function applyInstamartSelection({
  accessToken,
  addressId,
  items
} = {}) {
  const cart = await updateCart({
    accessToken,
    addressId,
    items
  });

  if (!cart.success) return cart;

  const liveCart = await getCart({ accessToken });

  if (!liveCart.success) return liveCart;

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

  return {
    ...result,
    provider: "swiggy_instamart",
    status: "order_placed"
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
