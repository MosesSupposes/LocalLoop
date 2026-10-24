import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { useUI } from './store'
import type {
  AdminOverview,
  Cart,
  Deal,
  FeedConfig,
  HomeFeed,
  LiveDrop,
  MenuItem,
  MerchantContext,
  MerchantOrder,
  MerchantSummary,
  Order,
  SessionUser,
  Storefront,
} from './types'

type Coords = { lat: number; lng: number }

function useCoords(): Coords {
  return useUI((s) => s.location)
}

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api.get<FeedConfig>('/api/config'), staleTime: 300_000 })
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<{ user: SessionUser | null }>('/api/me'),
    staleTime: 30_000,
  })
}

export function useHome() {
  const { lat, lng } = useCoords()
  const radiusM = useUI((s) => s.radiusM)
  return useQuery({
    queryKey: ['home', lat, lng, radiusM],
    queryFn: () => api.get<HomeFeed>(`/api/home?lat=${lat}&lng=${lng}&radius_m=${radiusM}`),
  })
}

export type NearbyFilters = { openNow: boolean; deals: boolean; pickup: boolean; category: string | null }

export function useNearby(filters: NearbyFilters) {
  const { lat, lng } = useCoords()
  const radiusM = useUI((s) => s.radiusM)
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng), radius_m: String(radiusM) })
  if (filters.openNow) params.set('open_now', '1')
  if (filters.deals) params.set('deals', '1')
  if (filters.pickup) params.set('pickup', '1')
  if (filters.category) params.set('category', filters.category)
  return useQuery({
    queryKey: ['nearby', params.toString()],
    queryFn: () => api.get<{ merchants: MerchantSummary[] }>(`/api/merchants/nearby?${params.toString()}`),
  })
}

export function useLiveDrops() {
  const { lat, lng } = useCoords()
  const radiusM = useUI((s) => s.radiusM)
  return useQuery({
    queryKey: ['drops', lat, lng, radiusM],
    queryFn: () => api.get<{ drops: LiveDrop[] }>(`/api/drops/live?lat=${lat}&lng=${lng}&radius_m=${radiusM}`),
  })
}

export function useStorefront(slug: string | undefined) {
  const { lat, lng } = useCoords()
  return useQuery({
    queryKey: ['storefront', slug, lat, lng],
    queryFn: () => api.get<Storefront>(`/api/merchants/${slug}?lat=${lat}&lng=${lng}`),
    enabled: Boolean(slug),
  })
}

export function useSearch(term: string) {
  return useQuery({
    queryKey: ['search', term],
    queryFn: () =>
      api.get<{ merchants: MerchantSummary[]; items: (MenuItem & { merchant_name: string; merchant_slug: string })[] }>(
        `/api/search?q=${encodeURIComponent(term)}`,
      ),
    enabled: term.trim().length > 1,
  })
}

/* --------------------------------------------------------------- speed dial & cart */

export function useToggleFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ merchantId, favorite }: { merchantId: string; favorite: boolean }) =>
      favorite ? api.del(`/api/favorites/${merchantId}`) : api.put(`/api/favorites/${merchantId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
      queryClient.invalidateQueries({ queryKey: ['storefront'] })
    },
  })
}

export function useCart() {
  return useQuery({ queryKey: ['cart'], queryFn: () => api.get<{ carts: Cart[] }>('/api/cart') })
}

export function useAddToCart() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      merchantId: string
      itemId: string
      qty: number
      options: { name: string; priceDeltaCents: number }[]
    }) => api.post<{ carts: Cart[] }>('/api/cart/items', body),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
  })
}

export function useUpdateCartLine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) => api.patch<{ carts: Cart[] }>(`/api/cart/items/${id}`, { qty }),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
  })
}

export function useRemoveCartLine() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<{ carts: Cart[] }>(`/api/cart/items/${id}`),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
  })
}

export function useClearCart() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (merchantId?: string) =>
      api.del<{ carts: Cart[] }>(merchantId ? `/api/cart?merchant_id=${merchantId}` : '/api/cart'),
    onSuccess: (data) => queryClient.setQueryData(['cart'], data),
  })
}

/* --------------------------------------------------------------- orders */

export function useOrders() {
  // Keyed by account: the endpoint answers a signed-out request with an empty list, so a
  // result fetched for one visitor must never be served to the next one who signs in.
  const userId = useUI((s) => s.user?.id ?? null)
  return useQuery({
    queryKey: ['orders', userId],
    queryFn: () => api.get<{ orders: Order[] }>('/api/orders'),
  })
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => api.get<{ order: Order }>(`/api/orders/${id}`),
    enabled: Boolean(id),
    // The tracker is the one screen that should feel live.
    refetchInterval: 5_000,
  })
}

export function usePlaceOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      merchantId: string
      pickupSlot: string | null
      tipCents: number
      note?: string
      paymentMethod: 'card' | 'apple_pay' | 'google_pay'
    }) => api.post<{ order: Order }>('/api/orders', { ...body, fulfillment: 'pickup' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['cart'] })
      queryClient.invalidateQueries({ queryKey: ['session'] })
    },
  })
}

export function useCancelOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<{ order: Order }>(`/api/orders/${id}/cancel`, { reason }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['order', variables.id] })
    },
  })
}

export function useReorder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<{ added: number }>(`/api/orders/${id}/reorder`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cart'] }),
  })
}

export function useReviewOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rating, body }: { id: string; rating: number; body?: string }) =>
      api.post(`/api/orders/${id}/review`, { rating, body }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      queryClient.invalidateQueries({ queryKey: ['order', variables.id] })
    },
  })
}

/* --------------------------------------------------------------- account */

export function useRequestOtp() {
  return useMutation({
    mutationFn: (email: string) =>
      api.post<{ sent: boolean; channel: string; devCode?: string }>('/api/auth/otp', { email }),
  })
}

export function useVerifyOtp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; code: string }) =>
      api.post<{ user: { id: string; displayName: string; email: string; locale: string } }>(
        '/api/auth/otp/verify',
        body,
      ),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/auth/logout', {}),
    onSuccess: () => queryClient.clear(),
  })
}

export function useUpdateMe() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/api/me', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] })
      queryClient.invalidateQueries({ queryKey: ['points'] })
    },
  })
}

export function useLoopPoints() {
  return useQuery({
    queryKey: ['points'],
    queryFn: () =>
      api.get<{ balance: number; history: { id: string; points: number; reason: string; created_at: string; merchant_name: string | null }[] }>(
        '/api/me/loop-points',
      ),
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ notifications: { id: string; type: string; title: string; read_at: string | null; created_at: string }[] }>(
        '/api/me/notifications',
      ),
  })
}

/* --------------------------------------------------------------- merchant dashboard */

export function useMerchantContext() {
  return useQuery({
    queryKey: ['merchant-context'],
    queryFn: () => api.get<MerchantContext>('/api/merchant/context'),
  })
}

export function useCreateMerchant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ merchant: { id: string; slug: string } }>('/api/merchant', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['merchant-context'] }),
  })
}

export function useMerchant(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['merchant', merchantId],
    queryFn: () => api.get<{ merchant: MerchantSummary & { payouts_connected: boolean; lat: number; lng: number } }>(`/api/merchant/${merchantId}`),
    enabled: Boolean(merchantId),
  })
}

export function usePatchMerchant(merchantId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/merchant/${merchantId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant', merchantId] })
      queryClient.invalidateQueries({ queryKey: ['merchant-context'] })
    },
  })
}

export function useMerchantOrders(merchantId: string | undefined, status = 'open') {
  return useQuery({
    queryKey: ['merchant-orders', merchantId, status],
    queryFn: () => api.get<{ orders: MerchantOrder[] }>(`/api/merchant/${merchantId}/orders?status=${status}`),
    enabled: Boolean(merchantId),
    refetchInterval: 5_000,
  })
}

export function useOrderAction(merchantId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: 'accept' | 'ready' | 'picked-up' | 'cancel' }) =>
      api.post(`/api/merchant/${merchantId}/orders/${orderId}/${action}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-orders', merchantId] })
      queryClient.invalidateQueries({ queryKey: ['merchant-context'] })
    },
  })
}

export function useMerchantMenu(merchantId: string | undefined) {
  return useQuery({
    queryKey: ['merchant-menu', merchantId],
    queryFn: () =>
      api.get<{
        categories: { id: string; name: string; sort: number }[]
        items: MenuItem[]
        drops: (LiveDrops & { id: string })[]
        deals: Deal[]
      }>(`/api/merchant/${merchantId}/menu`),
    enabled: Boolean(merchantId),
  })
}

type LiveDrops = { id: string; title: string; qty_total: number; qty_left: number; price_cents: number; ends_at: string; item_id: string | null }

function useMenuInvalidation(merchantId: string | undefined) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['merchant-menu', merchantId] })
}

export function useSaveItem(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId?: string; body: Record<string, unknown> }) =>
      itemId ? api.patch(`/api/merchant/${merchantId}/items/${itemId}`, body) : api.post(`/api/merchant/${merchantId}/items`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteItem(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  return useMutation({
    mutationFn: (itemId: string) => api.del(`/api/merchant/${merchantId}/items/${itemId}`),
    onSuccess: invalidate,
  })
}

export function useCreateCategory(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  return useMutation({
    mutationFn: (name: string) => api.post(`/api/merchant/${merchantId}/categories`, { name }),
    onSuccess: invalidate,
  })
}

export function useMenuImport() {
  return useMutation({
    mutationFn: (text: string) =>
      api.post<{ items: { name: string; description: string | null; priceCents: number; category: string }[] }>(
        '/api/menu-import',
        { text },
      ),
  })
}

export function usePhotoImport() {
  return useMutation({
    mutationFn: (body: { imageBase64: string; mime: string }) =>
      api.post<{ items: { name: string; description: string | null; priceCents: number; category: string }[]; mode: string; message?: string }>(
        '/api/menu-import/photo',
        body,
      ),
  })
}

export function useCreateDrop(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/merchant/${merchantId}/drops`, body),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['home'] })
      queryClient.invalidateQueries({ queryKey: ['storefront'] })
    },
  })
}

export function useCloseDrop(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (dropId: string) => api.post(`/api/merchant/${merchantId}/drops/${dropId}/close`, {}),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['home'] })
    },
  })
}

export function useCreateDeal(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/api/merchant/${merchantId}/deals`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteDeal(merchantId: string | undefined) {
  const invalidate = useMenuInvalidation(merchantId)
  return useMutation({
    mutationFn: (dealId: string) => api.del(`/api/merchant/${merchantId}/deals/${dealId}`),
    onSuccess: invalidate,
  })
}

export function useDealCopy(merchantId: string | undefined) {
  return useMutation({
    mutationFn: (body: { itemName?: string; discount: string }) =>
      api.post<{ copy: string }>(`/api/merchant/${merchantId}/deal-copy`, body),
  })
}

export function useAnalytics(merchantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['analytics', merchantId],
    queryFn: () =>
      api.get<{
        summary: Record<string, number>
        daily: { day: string; revenue_cents: number; orders: number }[]
        topItems: { name: string; qty: number; revenue_cents: number }[]
      }>(`/api/merchant/${merchantId}/analytics`),
    enabled: Boolean(merchantId) && enabled,
  })
}

export function usePayouts(merchantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payouts', merchantId],
    queryFn: () =>
      api.get<{ mode: string; connected: boolean; note: string; rows: { day: string; payout_cents: number; platform_fee_cents: number; orders: number }[] }>(
        `/api/merchant/${merchantId}/payouts`,
      ),
    enabled: Boolean(merchantId) && enabled,
  })
}

export function useStripeConnect(merchantId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api.post<{ configured: boolean; message?: string; onboardingUrl?: string | null }>(
        `/api/merchant/${merchantId}/stripe-connect`,
        {},
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['merchant', merchantId] }),
  })
}

/* --------------------------------------------------------------- neighborhood ops */

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api.get<AdminOverview>('/api/admin/overview'),
  })
}

export function useAdminMerchants(status?: string) {
  return useQuery({
    queryKey: ['admin-merchants', status ?? 'all'],
    queryFn: () =>
      api.get<{ merchants: (MerchantSummary & { owner_name: string; item_count: number; created_at: string })[] }>(
        `/api/admin/merchants${status ? `?status=${status}` : ''}`,
      ),
  })
}

export function useMerchantStatusAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'pending' | 'live' | 'paused' }) =>
      api.post(`/api/admin/merchants/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-merchants'] })
      queryClient.invalidateQueries({ queryKey: ['home'] })
    },
  })
}

export function useFeatureMerchant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      api.post(`/api/admin/merchants/${id}/featured`, { featured }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
      queryClient.invalidateQueries({ queryKey: ['admin-merchants'] })
    },
  })
}

export function useAdminNeighborhoods() {
  return useQuery({
    queryKey: ['admin-neighborhoods'],
    queryFn: () =>
      api.get<{ neighborhoods: { id: string; name: string; slug: string; city: string; active: boolean; merchant_count: number; live_count: number }[] }>(
        '/api/admin/neighborhoods',
      ),
  })
}

export function useCreateNeighborhood() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/api/admin/neighborhoods', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    },
  })
}

export function useRefundOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) => api.post(`/api/admin/orders/${orderId}/refund`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-overview'] }),
  })
}

export function useAdminAudit() {
  return useQuery({
    queryKey: ['admin-audit'],
    queryFn: () =>
      api.get<{ entries: { id: string; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown>; created_at: string; actor_name: string | null }[] }>(
        '/api/admin/audit',
      ),
  })
}
