data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "app" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${local.name_prefix}-vpc"
  }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.app.id
  cidr_block        = cidrsubnet(aws_vpc.app.cidr_block, 8, count.index + 1)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "${local.name_prefix}-private-${count.index + 1}"
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.app.id

  tags = {
    Name = "${local.name_prefix}-private"
  }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# S3 is reached via this gateway endpoint (cheaper and faster than the NAT path).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.app.id
  service_name      = "com.amazonaws.${local.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
}

# The Lambda lives in private subnets, but Google sign-in must fetch Google's
# public signing certs from www.googleapis.com to verify an ID token (Stripe
# calls need public egress too). VPC endpoints only cover AWS services, so
# without this NAT path /api/auth/google hangs until the connect timeout.
resource "aws_internet_gateway" "app" {
  count = var.enable_nat_gateway ? 1 : 0

  vpc_id = aws_vpc.app.id

  tags = {
    Name = "${local.name_prefix}-igw"
  }
}

resource "aws_subnet" "public" {
  count = var.enable_nat_gateway ? 1 : 0

  vpc_id                  = aws_vpc.app.id
  cidr_block              = cidrsubnet(aws_vpc.app.cidr_block, 8, count.index + 11)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${local.name_prefix}-public-${count.index + 1}"
  }
}

resource "aws_route_table" "public" {
  count = var.enable_nat_gateway ? 1 : 0

  vpc_id = aws_vpc.app.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.app[0].id
  }

  tags = {
    Name = "${local.name_prefix}-public"
  }
}

resource "aws_route_table_association" "public" {
  count = var.enable_nat_gateway ? 1 : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_eip" "nat" {
  count = var.enable_nat_gateway ? 1 : 0

  domain = "vpc"

  tags = {
    Name = "${local.name_prefix}-nat"
  }
}

# One NAT (not one per AZ): this carries occasional auth/billing calls, not bulk
# traffic, so the extra hourly charge per AZ is not worth it.
resource "aws_nat_gateway" "app" {
  count = var.enable_nat_gateway ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.app]

  tags = {
    Name = "${local.name_prefix}-nat"
  }
}

resource "aws_route" "private_nat" {
  count = var.enable_nat_gateway ? 1 : 0

  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.app[0].id
}

resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda"
  description = "API Lambda ENIs (VPC, no public IP)"
  vpc_id      = aws_vpc.app.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name_prefix}-vpce"
  description = "Interface VPC endpoints"
  vpc_id      = aws_vpc.app.id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds"
  description = "Postgres from API Lambda only"
  vpc_id      = aws_vpc.app.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }
}

locals {
  interface_services = [
    "secretsmanager",
    "logs",
    "lambda",
    "ecr.api",
    "ecr.dkr",
    "sts",
  ]
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_services)

  vpc_id              = aws_vpc.app.id
  service_name        = "com.amazonaws.${local.region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = true
}
