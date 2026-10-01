import { buildInstamartCartPreview, updateCart, getCart, getPaymentOptions, checkout, trackOrder } from "./swiggy-instamart-mcp.mjs";

function clean(value) {
  return String(value ?? "").trim();
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
    const data = search?.result?.data || {};
    const products = Array.isArray(data?.products) ? data.products : [];
    return products.flatMap((product) => {
      const variants = Array.isArray(product?.variants)
        ? product.variants
        : Array.isArray(product?.variations)
          ? product.variations
          : [];
      return variants.map((variant) => ({
        requested: search.requested,
        quantity: search.quantity,
        name: product?.name || variant?.name || search.requested,
        imageUrl: product?.imageUrl || null,
        price: variant?.price ?? product?.price ?? null,
        pack: variant?.name || variant?.packSize || "",
        spinId: variant?.spinId || variant?.id || null,
        skuId: variant?.skuId || product?.skuId || null,
        inStock: variant?.inStock ?? product?.inStock ?? null
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
      : "I couldn't find an in-stock match for those items on Instamart."
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
