package com.easy1staking.shithole.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.List;

/**
 * Web-tier configuration: CORS for the FE.
 *
 * <p>The FE (Next.js dev server, or a production CDN) runs on a different
 * origin than the BE. Without CORS, browsers block the {@code /api/*} fetch
 * with a "Failed to fetch" error and no response body. We allow a configurable
 * comma-separated allowlist via {@code shithole.cors.allowed-origins}.
 *
 * <p>Defaults to local-dev origins. Production deployments should set
 * {@code SHITHOLE_CORS_ALLOWED_ORIGINS} to the deployed FE URL.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Value("${shithole.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}")
    private List<String> allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.toArray(new String[0]))
                .allowedMethods("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .exposedHeaders("Content-Type")
                .allowCredentials(false)
                .maxAge(3600);
    }
}
