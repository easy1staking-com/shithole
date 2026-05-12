package com.easy1staking.shithole.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.Arrays;
import java.util.Objects;

/**
 * Composite primary key for {@link ListingEventEntity}.
 *
 * <p>Mirrors the on-chain {@code (tx_hash, output_index)} tuple that uniquely
 * identifies a UTxO. Implements {@link #equals(Object)} / {@link #hashCode()}
 * by hand because Lombok's generated versions use {@link Object#equals(Object)}
 * for the {@code byte[]} field, which compares by reference — JPA needs
 * structural equality of the key (see Hibernate ORM docs on composite keys
 * with primitive array fields).
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ListingEventId implements Serializable {

    private byte[] txHash;
    private Integer outputIndex;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ListingEventId that)) return false;
        return Objects.equals(outputIndex, that.outputIndex)
                && Arrays.equals(txHash, that.txHash);
    }

    @Override
    public int hashCode() {
        return 31 * Objects.hashCode(outputIndex) + Arrays.hashCode(txHash);
    }
}
