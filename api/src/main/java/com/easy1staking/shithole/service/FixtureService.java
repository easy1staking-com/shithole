package com.easy1staking.shithole.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;

/**
 * Bootstrap-only: serves API responses from packaged JSON fixtures at
 * {@code classpath:fixtures/api/...}. Real DB-backed implementations land in the
 * next phase; until then this lets the FE develop against the live BE.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class FixtureService {

    private final ObjectMapper objectMapper;

    /**
     * Read a packaged fixture JSON and return its raw bytes.
     * Returns {@code null} if the resource does not exist.
     */
    public byte[] loadFixtureBytes(String resourcePath) throws IOException {
        ClassPathResource resource = new ClassPathResource(resourcePath);
        if (!resource.exists()) {
            log.warn("Fixture not found: {}", resourcePath);
            return null;
        }
        try (InputStream in = resource.getInputStream()) {
            return in.readAllBytes();
        }
    }

    /**
     * Read a packaged fixture JSON and bind to a typed DTO.
     */
    public <T> T loadFixture(String resourcePath, Class<T> type) throws IOException {
        byte[] bytes = loadFixtureBytes(resourcePath);
        if (bytes == null) {
            return null;
        }
        return objectMapper.readValue(bytes, type);
    }

    /**
     * Read a packaged fixture JSON and bind to a generic type via TypeReference.
     */
    public <T> T loadFixture(String resourcePath, com.fasterxml.jackson.core.type.TypeReference<T> typeRef)
            throws IOException {
        byte[] bytes = loadFixtureBytes(resourcePath);
        if (bytes == null) {
            return null;
        }
        return objectMapper.readValue(bytes, typeRef);
    }
}
