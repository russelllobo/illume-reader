#if os(iOS)
import Foundation
import IllumeCore
import StoreKit

@MainActor
final class BillingService: ObservableObject {
    @Published var products: [Product] = []
    @Published var isPurchasing = false
    @Published var message = ""
    @Published var hasActiveProEntitlement = false

    private let backend: SupabaseBackend
    private let productIds = [BillingAccess.appleProductId]
    private var updatesTask: Task<Void, Never>?

    var proProduct: Product? {
        products.first { $0.id == BillingAccess.appleProductId }
    }

    init(backend: SupabaseBackend) {
        self.backend = backend
        updatesTask = listenForTransactions()
    }

    deinit {
        updatesTask?.cancel()
    }

    func loadProducts() async {
        do {
            products = try await Product.products(for: productIds)
            message = proProduct == nil ? "Illume Pro is not available in this storefront yet." : ""
        } catch {
            message = "Could not load Pro."
        }
    }

    func purchase(accessToken: String) async throws {
        guard let product = proProduct else {
            await loadProducts()
            guard let product = proProduct else { throw StoreKitError.notAvailableInStorefront }
            try await purchase(product: product, accessToken: accessToken)
            return
        }
        try await purchase(product: product, accessToken: accessToken)
    }

    func restore(accessToken: String) async throws {
        try await AppStore.sync()
        var foundEntitlement = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  isActivePro(transaction) else {
                continue
            }
            foundEntitlement = true
            try await sync(transaction: transaction, signedTransactionInfo: result.jwsRepresentation, accessToken: accessToken)
            await transaction.finish()
        }
        hasActiveProEntitlement = foundEntitlement
    }

    func refreshCurrentEntitlements(accessToken: String) async {
        var foundEntitlement = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  isActivePro(transaction) else {
                continue
            }
            foundEntitlement = true
            try? await sync(transaction: transaction, signedTransactionInfo: result.jwsRepresentation, accessToken: accessToken)
        }
        hasActiveProEntitlement = foundEntitlement
    }

    private func purchase(product: Product, accessToken: String) async throws {
        isPurchasing = true
        defer { isPurchasing = false }

        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            guard case .verified(let transaction) = verification else {
                throw StoreKitError.userCancelled
            }
            try await sync(transaction: transaction, signedTransactionInfo: verification.jwsRepresentation, accessToken: accessToken)
            hasActiveProEntitlement = isActivePro(transaction)
            await transaction.finish()
        case .pending:
            message = "Purchase pending."
        case .userCancelled:
            break
        @unknown default:
            break
        }
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self,
                      case .verified(let transaction) = result,
                      await self.isActivePro(transaction),
                      let session = KeychainStore.loadSession() else {
                    continue
                }
                try? await self.sync(transaction: transaction, signedTransactionInfo: result.jwsRepresentation, accessToken: session.accessToken)
                await MainActor.run {
                    self.hasActiveProEntitlement = true
                }
                await transaction.finish()
            }
        }
    }

    private func isActivePro(_ transaction: Transaction) -> Bool {
        transaction.productID == BillingAccess.appleProductId
            && transaction.revocationDate == nil
            && (transaction.expirationDate ?? .distantFuture) > Date()
    }

    private func sync(transaction: Transaction, signedTransactionInfo: String, accessToken: String) async throws {
        _ = try await backend.syncAppleSubscription(
            AppleSubscriptionSyncRequest(
                signedTransactionInfo: signedTransactionInfo,
                appTransaction: try? await AppTransaction.shared.jwsRepresentation
            ),
            accessToken: accessToken
        )
    }
}
#endif
