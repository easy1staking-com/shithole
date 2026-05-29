package com.easy1staking.shithole.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Objects;

/**
 * Composite primary key for {@link MarketplaceEventEntity}. Mirrors
 * {@link WantedListingEventId} — hand-rolled equals/hashCode because
 * Lombok's generated versions use reference equality on {@code byte[]}.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MarketplaceEventId implements Serializable {

    private byte[] txHash;
    private Integer outputIndex;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof MarketplaceEventId that)) return false;
        return Objects.equals(outputIndex, that.outputIndex)
                && Arrays.equals(txHash, that.txHash);
    }

    @Override
    public int hashCode() {
        return 31 * Arrays.hashCode(txHash) + Objects.hashCode(outputIndex);
    }
}
