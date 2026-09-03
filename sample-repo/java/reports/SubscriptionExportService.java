package reports;

import java.util.List;

/**
 * Planted unbounded-query: fetches every subscription row into memory in
 * one call instead of paginating with a Pageable. TerraTrace should flag
 * the `findAll()` call below.
 */
public class SubscriptionExportService {
    private final SubscriptionRepository subscriptionRepository;

    public SubscriptionExportService(SubscriptionRepository subscriptionRepository) {
        this.subscriptionRepository = subscriptionRepository;
    }

    public List<Subscription> exportAllSubscriptions() {
        return subscriptionRepository.findAll();
    }
}
