# Daneizo / LendLocal (Working Title)

A peer-to-peer rental platform designed to let neighbors borrow infrequently used household items and tools (power drills, ladders, seasonal gear) instead of buying them. Built with a focus on hyper-local community trust and dynamic QR code handoffs.

## 🏗 Tech Stack

**Frontend**
*   **Framework:** Angular (Standalone Components, Signals)
*   **Type:** Progressive Web App (PWA) for mobile camera/QR access
*   **Maps:** Google Maps / Mapbox API

**Backend (Event-Driven Microservices)**
*   **Framework:** NestJS
*   **Communication:** RabbitMQ / Kafka (Asynchronous messaging)
*   **Database:** PostgreSQL with **PostGIS** (Geospatial queries)
*   **Caching/Real-time:** Redis (WebSockets Pub/Sub)
*   **Payments:** Stripe Connect (Escrow, security deposits, multi-party payouts)

## 🏛 System Architecture

The backend operates as an event-driven microservice ecosystem to ensure fault tolerance and decoupled scaling. 
*   **API Gateway:** Single entry point for the Angular client.
*   **Microservices:** Identity, Catalog & Geospatial, Bookings, Payments, and Notifications.
*   *Note: Services communicate asynchronously via a message broker to prevent cascading failures.*

## 🚧 Current Status

**Status:** Initial planning & infrastructure setup. 

*   [x] System architecture defined
*   [ ] Initialize Angular workspace
*   [ ] Initialize NestJS monorepo/microservices
*   [ ] Dockerize PostgreSQL/PostGIS & Message Broker

## 🚀 Getting Started (Coming Soon)

Instructions for running the local development environment using Docker Compose will be added here as the microservices are initialized.
