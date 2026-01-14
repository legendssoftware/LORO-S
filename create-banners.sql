-- SQL Script to create banners for Organization 1 and Organization 2
-- This script creates banners with all required fields from banners.entity.ts

-- Banner 1: News Banner for Organization 1
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Welcome to Our Store',
    'Discover Amazing Products',
    'Explore our wide range of high-quality products. From drywall materials to roof sealants, we have everything you need for your construction projects.',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
    'news',
    1,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 2: Promotions Banner for Organization 1
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Summer Sale',
    'Up to 30% Off Selected Items',
    'Take advantage of our summer promotion. Get discounts on gypsum boards, partition systems, and more. Limited time offer!',
    'https://images.unsplash.com/photo-1607082349566-187342175e2f?w=800',
    'promotions',
    1,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 3: Events Banner for Organization 1
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Construction Expo 2024',
    'Join Us at the Biggest Construction Event',
    'Visit our booth at the annual construction expo. Meet our team, see live demonstrations, and get exclusive deals.',
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800',
    'events',
    1,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 4: Blog Banner for Organization 1
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Latest Construction Tips',
    'Expert Advice for Your Projects',
    'Read our latest blog posts about drywall installation, partition systems, and roof maintenance. Get expert tips and tricks.',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800',
    'blog',
    1,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 5: News Banner for Organization 2
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'New Product Line Available',
    'Premium Drywall & Partition Materials',
    'We are excited to announce our new premium product line. Featuring fire-rated gypsum boards, acoustic panels, and moisture-resistant materials.',
    'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=800',
    'news',
    2,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 6: Promotions Banner for Organization 2
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Bulk Order Discount',
    'Save More When You Buy in Bulk',
    'Order pallets of our products and save big! Perfect for contractors and large projects. Contact us for custom pricing.',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
    'promotions',
    2,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 7: Events Banner for Organization 2
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Product Launch Event',
    'See Our New Roof Sealant Line',
    'Join us for the launch of our new professional-grade roof sealant products. Live demonstrations and special launch pricing available.',
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800',
    'events',
    2,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 8: Blog Banner for Organization 2
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Construction Industry Insights',
    'Stay Updated with Industry News',
    'Get the latest updates on construction trends, material innovations, and best practices. Our expert team shares valuable insights.',
    'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800',
    'blog',
    2,
    NULL,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 9: Other Banner for Organization 1 (Branch-specific)
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Branch Opening',
    'New Location Now Open',
    'We are pleased to announce the opening of our new branch. Visit us for personalized service and local expertise.',
    'https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=800',
    'other',
    1,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Banner 10: Other Banner for Organization 2 (Branch-specific)
INSERT INTO banners (
    title,
    subtitle,
    description,
    image,
    category,
    "organisationUid",
    "branchUid",
    "createdAt",
    "updatedAt"
) VALUES (
    'Customer Appreciation',
    'Thank You for Your Support',
    'We appreciate your continued support. As a token of our gratitude, enjoy special discounts and priority service.',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800',
    'other',
    2,
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- Verify the banners were created
SELECT 
    uid,
    title,
    subtitle,
    category,
    "organisationUid",
    "branchUid",
    "createdAt"
FROM banners
WHERE "organisationUid" IN (1, 2)
ORDER BY "organisationUid", "createdAt";
